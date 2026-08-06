import {
  applySettlementOffsets,
  buildPurchaseAllocations,
  computeSettleTransfers,
  type SplitMode,
} from '@biko/shared';
import type {
  Prisma,
  PrismaClient,
  TripExpenseCategory,
  TripListItemType,
  TripMemberRole,
  TripStatus,
} from '@prisma/client';
import { allocateUniqueShareSlug } from './trip-slug.js';

type Db = PrismaClient | Prisma.TransactionClient;

export class TripNotFoundError extends Error {
  constructor(message = 'Viaje no encontrado') {
    super(message);
    this.name = 'TripNotFoundError';
  }
}

export class TripForbiddenError extends Error {
  constructor(message = 'No tenés acceso a este viaje') {
    super(message);
    this.name = 'TripForbiddenError';
  }
}

export class TripValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TripValidationError';
  }
}

export class TripClosedError extends Error {
  constructor(message = 'El viaje está cerrado') {
    super(message);
    this.name = 'TripClosedError';
  }
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function toNum(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === 'object' && value !== null && 'toNumber' in value) {
    return (value as { toNumber(): number }).toNumber();
  }
  return Number(value);
}

const memberSelect = {
  id: true,
  tripId: true,
  userId: true,
  displayName: true,
  role: true,
  inviteStatus: true,
  tripHouseholdId: true,
  createdAt: true,
} as const;

const householdSelect = {
  id: true,
  tripId: true,
  name: true,
  createdAt: true,
  updatedAt: true,
} as const;

const expenseInclude = {
  paidByMember: { select: memberSelect },
  payments: {
    include: { tripMember: { select: memberSelect } },
    orderBy: { tripMemberId: 'asc' as const },
  },
  allocations: {
    include: { tripMember: { select: memberSelect } },
    orderBy: { tripMemberId: 'asc' as const },
  },
} as const;

export type TripActor =
  | { userId: string }
  | { tripMemberId: string; guestTripId: string };

function normalizeActor(actor: TripActor | string): TripActor {
  return typeof actor === 'string' ? { userId: actor } : actor;
}

export function isGuestActor(actor: TripActor | string): boolean {
  const a = normalizeActor(actor);
  return 'tripMemberId' in a;
}

export async function requireTripMember(db: Db, tripId: string, actor: TripActor | string) {
  const a = normalizeActor(actor);
  if ('tripMemberId' in a) {
    if (a.guestTripId !== tripId) throw new TripForbiddenError();
    const member = await db.tripMember.findFirst({
      where: { id: a.tripMemberId, tripId, inviteStatus: 'JOINED' },
      include: { trip: true },
    });
    if (!member) throw new TripForbiddenError();
    return member;
  }

  const member = await db.tripMember.findFirst({
    where: { tripId, userId: a.userId, inviteStatus: 'JOINED' },
    include: { trip: true },
  });
  if (!member) throw new TripForbiddenError();
  return member;
}

export async function requireTripOrganizer(db: Db, tripId: string, actor: TripActor | string) {
  const member = await requireTripMember(db, tripId, actor);
  if (member.role !== 'ORGANIZER') {
    throw new TripForbiddenError('Solo el organizador puede hacer esto');
  }
  return member;
}

function assertTripWritable(status: TripStatus) {
  if (status === 'CLOSED') throw new TripClosedError();
}

export async function listTripsForUser(db: Db, userId: string) {
  const memberships = await db.tripMember.findMany({
    where: { userId, inviteStatus: 'JOINED' },
    select: { tripId: true },
  });
  const tripIds = memberships.map((m) => m.tripId);
  if (tripIds.length === 0) return [];

  const trips = await db.trip.findMany({
    where: { id: { in: tripIds } },
    include: {
      members: { where: { inviteStatus: 'JOINED' }, select: memberSelect },
      _count: { select: { expenses: true } },
    },
    orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
  });

  // Active/planning first, then closed
  const rank = (s: TripStatus) => (s === 'CLOSED' ? 1 : 0);
  return trips
    .sort((a, b) => rank(a.status) - rank(b.status) || b.updatedAt.getTime() - a.updatedAt.getTime())
    .map((t) => ({
      id: t.id,
      name: t.name,
      destination: t.destination,
      startDate: t.startDate,
      endDate: t.endDate,
      status: t.status,
      baseCurrency: t.baseCurrency,
      memberCount: t.members.length,
      expenseCount: t._count.expenses,
      exportedAt: t.exportedAt,
      updatedAt: t.updatedAt,
      createdAt: t.createdAt,
    }));
}

export async function createTrip(
  db: Db,
  userId: string,
  input: {
    name: string;
    destination?: string | null;
    startDate?: Date | null;
    endDate?: Date | null;
    baseCurrency?: string;
  },
  userName: string,
) {
  const name = input.name.trim();
  if (!name) throw new TripValidationError('El nombre es obligatorio');

  const shareSlug = await allocateUniqueShareSlug(
    async (slug) => Boolean(await db.trip.findUnique({ where: { shareSlug: slug }, select: { id: true } })),
    name,
    input.startDate ?? null,
  );

  return db.trip.create({
    data: {
      createdByUserId: userId,
      name,
      shareSlug,
      destination: input.destination?.trim() || null,
      startDate: input.startDate ?? null,
      endDate: input.endDate ?? null,
      baseCurrency: input.baseCurrency ?? 'ARS',
      status: 'ACTIVE',
      members: {
        create: {
          userId,
          displayName: userName.trim() || 'Organizador',
          role: 'ORGANIZER',
          inviteStatus: 'JOINED',
        },
      },
      invites: {
        create: {
          createdByUserId: userId,
        },
      },
    },
    include: {
      members: { select: memberSelect },
      invites: true,
      accommodation: true,
    },
  });
}

export async function getTripHub(
  db: Db,
  tripId: string,
  actor: TripActor | string,
  householdId: string | null | undefined,
  opts?: { isGuestSession?: boolean },
) {
  const me = await requireTripMember(db, tripId, actor);
  const trip = await db.trip.findUnique({
    where: { id: tripId },
    include: {
      members: {
        where: { inviteStatus: { not: 'DECLINED' } },
        select: memberSelect,
        orderBy: { displayName: 'asc' },
      },
      households: { select: householdSelect, orderBy: { name: 'asc' } },
      invites: { orderBy: { createdAt: 'desc' }, take: 1 },
      accommodation: true,
      exportBatches: householdId
        ? {
            where: { householdId },
            take: 1,
          }
        : false,
    },
  });
  if (!trip) throw new TripNotFoundError();

  // Lazy backfill: pre-migration stay costs without linked Alojamiento expense
  if (
    trip.accommodation &&
    trip.accommodation.amount != null &&
    toNum(trip.accommodation.amount) > 0 &&
    !trip.accommodation.expenseId &&
    trip.status !== 'CLOSED'
  ) {
    trip.accommodation = await syncAccommodationExpense(
      db,
      tripId,
      trip.accommodation,
      trip.baseCurrency,
    );
  }

  const balance = await computeTripBalance(db, tripId);
  const categoryTotals = await computeCategoryTotals(db, tripId);
  const totalSpent = round2(categoryTotals.reduce((s, c) => s + c.total, 0));

  const isOrganizer = me.role === 'ORGANIZER';
  const exportBatches = Array.isArray(trip.exportBatches) ? trip.exportBatches : [];
  const alreadyExported =
    exportBatches.length > 0 || (householdId != null && trip.exportHouseholdId === householdId);
  const canExport =
    isOrganizer &&
    trip.status === 'CLOSED' &&
    !alreadyExported &&
    Boolean(householdId) &&
    !opts?.isGuestSession;

  return {
    ...serializeTrip(trip),
    myMember: serializeMember(me),
    isOrganizer,
    canExport,
    alreadyExported,
    isGuestSession: Boolean(opts?.isGuestSession),
    balance: {
      perMember: balance.perMember,
      perUnit: balance.perUnit,
      transfers: balance.transfers,
      settlements: balance.settlements,
    },
    categoryTotals,
    totalSpent,
  };
}

function serializeMember(m: {
  id: string;
  tripId: string;
  userId: string | null;
  displayName: string;
  role: TripMemberRole;
  inviteStatus: string;
  tripHouseholdId?: string | null;
  createdAt: Date;
}) {
  return {
    id: m.id,
    tripId: m.tripId,
    userId: m.userId,
    displayName: m.displayName,
    role: m.role,
    inviteStatus: m.inviteStatus,
    tripHouseholdId: m.tripHouseholdId ?? null,
    createdAt: m.createdAt,
  };
}

function serializeHousehold(h: {
  id: string;
  tripId: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: h.id,
    tripId: h.tripId,
    name: h.name,
    createdAt: h.createdAt,
    updatedAt: h.updatedAt,
  };
}

function serializeTrip(trip: {
  id: string;
  createdByUserId: string;
  name: string;
  shareSlug: string;
  destination: string | null;
  startDate: Date | null;
  endDate: Date | null;
  status: TripStatus;
  baseCurrency: string;
  exportHouseholdId: string | null;
  exportBatchId: string | null;
  exportedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  members: Array<{
    id: string;
    tripId: string;
    userId: string | null;
    displayName: string;
    role: TripMemberRole;
    inviteStatus: string;
    tripHouseholdId?: string | null;
    createdAt: Date;
  }>;
  households?: Array<{
    id: string;
    tripId: string;
    name: string;
    createdAt: Date;
    updatedAt: Date;
  }>;
  invites: Array<{ id: string; code: string; expiresAt: Date | null; createdAt: Date }>;
  accommodation: {
    id: string;
    label: string | null;
    address: string | null;
    checkIn: Date | null;
    checkOut: Date | null;
    checkInTime: string | null;
    checkOutTime: string | null;
    amount: unknown;
    expenseId: string | null;
    link: string | null;
    notes: string | null;
  } | null;
}) {
  return {
    id: trip.id,
    createdByUserId: trip.createdByUserId,
    name: trip.name,
    shareSlug: trip.shareSlug,
    destination: trip.destination,
    startDate: trip.startDate,
    endDate: trip.endDate,
    status: trip.status,
    baseCurrency: trip.baseCurrency,
    exportHouseholdId: trip.exportHouseholdId,
    exportBatchId: trip.exportBatchId,
    exportedAt: trip.exportedAt,
    createdAt: trip.createdAt,
    updatedAt: trip.updatedAt,
    members: [...trip.members]
      .sort((a, b) => a.displayName.localeCompare(b.displayName, 'es', { sensitivity: 'base' }))
      .map(serializeMember),
    households: [...(trip.households ?? [])]
      .sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }))
      .map(serializeHousehold),
    inviteCode: trip.shareSlug,
    accommodation: trip.accommodation ? serializeAccommodation(trip.accommodation) : null,
  };
}

function serializeAccommodation(acc: {
  id: string;
  label: string | null;
  address: string | null;
  checkIn: Date | null;
  checkOut: Date | null;
  checkInTime: string | null;
  checkOutTime: string | null;
  amount: unknown;
  expenseId?: string | null;
  link: string | null;
  notes: string | null;
}) {
  return {
    id: acc.id,
    label: acc.label,
    address: acc.address,
    checkIn: acc.checkIn,
    checkOut: acc.checkOut,
    checkInTime: acc.checkInTime,
    checkOutTime: acc.checkOutTime,
    amount: acc.amount == null ? null : toNum(acc.amount),
    expenseId: acc.expenseId ?? null,
    link: acc.link,
    notes: acc.notes,
  };
}

export async function updateTrip(
  db: Db,
  tripId: string,
  actor: TripActor | string,
  input: {
    name?: string;
    destination?: string | null;
    startDate?: Date | null;
    endDate?: Date | null;
    status?: TripStatus;
  },
) {
  const me = await requireTripMember(db, tripId, actor);
  if (input.status === 'CLOSED' || (input.status === 'ACTIVE' && me.trip.status === 'CLOSED')) {
    if (me.role !== 'ORGANIZER') {
      throw new TripForbiddenError('Solo el organizador puede cerrar o reabrir el viaje');
    }
  } else {
    assertTripWritable(me.trip.status);
  }

  const data: Prisma.TripUpdateInput = {};
  if (input.name != null) {
    const name = input.name.trim();
    if (!name) throw new TripValidationError('El nombre es obligatorio');
    data.name = name;
  }
  if (input.destination !== undefined) data.destination = input.destination?.trim() || null;
  if (input.startDate !== undefined) data.startDate = input.startDate;
  if (input.endDate !== undefined) data.endDate = input.endDate;
  if (input.status != null) data.status = input.status;

  return db.trip.update({
    where: { id: tripId },
    data,
    include: {
      members: {
        where: { inviteStatus: { not: 'DECLINED' } },
        select: memberSelect,
        orderBy: { displayName: 'asc' },
      },
      households: { select: householdSelect, orderBy: { name: 'asc' } },
      invites: { orderBy: { createdAt: 'desc' }, take: 1 },
      accommodation: true,
    },
  });
}

export async function closeTrip(db: Db, tripId: string, actor: TripActor | string) {
  await requireTripOrganizer(db, tripId, actor);
  return db.trip.update({
    where: { id: tripId },
    data: { status: 'CLOSED' },
  });
}

export async function mintTripInvite(db: Db, tripId: string, userId: string) {
  await requireTripOrganizer(db, tripId, userId);
  assertTripWritable((await db.trip.findUniqueOrThrow({ where: { id: tripId } })).status);

  const invite = await db.tripInvite.create({
    data: { tripId, createdByUserId: userId },
  });
  const trip = await db.trip.findUniqueOrThrow({
    where: { id: tripId },
    select: { shareSlug: true },
  });
  return { ...invite, shareSlug: trip.shareSlug };
}

async function findInviteByCodeOrSlug(db: Db, codeOrSlug: string) {
  const key = codeOrSlug.trim();
  const byCode = await db.tripInvite.findUnique({
    where: { code: key },
    include: { trip: true },
  });
  if (byCode) return byCode;

  const trip = await db.trip.findUnique({ where: { shareSlug: key } });
  if (!trip) return null;

  return db.tripInvite.findFirst({
    where: { tripId: trip.id },
    orderBy: { createdAt: 'desc' },
    include: { trip: true },
  });
}

export async function getTripInvitePreview(db: Db, code: string) {
  const invite = await findInviteByCodeOrSlug(db, code);
  if (!invite) throw new TripNotFoundError('Código de invitación inválido');
  if (invite.expiresAt && invite.expiresAt < new Date()) {
    throw new TripValidationError('La invitación expiró');
  }

  const unclaimedMembers = await db.tripMember.findMany({
    where: {
      tripId: invite.tripId,
      inviteStatus: 'PENDING',
      userId: null,
    },
    select: memberSelect,
    orderBy: { displayName: 'asc' },
  });

  return {
    code: invite.trip.shareSlug,
    inviteToken: invite.code,
    expiresAt: invite.expiresAt,
    trip: {
      id: invite.trip.id,
      name: invite.trip.name,
      shareSlug: invite.trip.shareSlug,
      destination: invite.trip.destination,
      status: invite.trip.status,
      startDate: invite.trip.startDate,
      endDate: invite.trip.endDate,
    },
    unclaimedMembers: [...unclaimedMembers]
      .sort((a, b) => a.displayName.localeCompare(b.displayName, 'es', { sensitivity: 'base' }))
      .map(serializeMember),
  };
}

export async function joinTripByCode(
  db: Db,
  userId: string | null,
  userName: string,
  code: string,
  opts?: { displayName?: string | null; claimMemberId?: string | null },
) {
  const invite = await findInviteByCodeOrSlug(db, code);
  if (!invite) throw new TripNotFoundError('Código de invitación inválido');
  if (invite.expiresAt && invite.expiresAt < new Date()) {
    throw new TripValidationError('La invitación expiró');
  }
  if (invite.trip.status === 'CLOSED') {
    throw new TripValidationError('El viaje ya está cerrado');
  }

  if (userId) {
    const existing = await db.tripMember.findFirst({
      where: { tripId: invite.tripId, userId },
    });
    if (existing) {
      if (existing.inviteStatus !== 'JOINED') {
        return db.tripMember.update({
          where: { id: existing.id },
          data: {
            inviteStatus: 'JOINED',
            displayName: opts?.displayName?.trim() || existing.displayName || userName,
          },
          include: { trip: true },
        });
      }
      return { ...existing, trip: invite.trip };
    }
  }

  if (opts?.claimMemberId) {
    const slot = await db.tripMember.findFirst({
      where: {
        id: opts.claimMemberId,
        tripId: invite.tripId,
        inviteStatus: 'PENDING',
        userId: null,
      },
    });
    if (!slot) {
      throw new TripValidationError('Ese lugar ya fue reclamado o no existe');
    }
    return db.tripMember.update({
      where: { id: slot.id },
      data: {
        userId: userId ?? null,
        inviteStatus: 'JOINED',
        displayName: opts.displayName?.trim() || slot.displayName || userName,
      },
      include: { trip: true },
    });
  }

  const displayName = opts?.displayName?.trim() || userName;
  if (!displayName) {
    throw new TripValidationError('Ingresá tu nombre');
  }

  return db.tripMember.create({
    data: {
      tripId: invite.tripId,
      userId: userId ?? null,
      displayName,
      role: 'MEMBER',
      inviteStatus: 'JOINED',
    },
    include: { trip: true },
  });
}

/** Link a guest trip seat to a registered user account. */
export async function linkTripMemberToUser(
  db: Db,
  tripId: string,
  tripMemberId: string,
  userId: string,
  displayName?: string | null,
) {
  const member = await db.tripMember.findFirst({
    where: { id: tripMemberId, tripId, inviteStatus: 'JOINED' },
  });
  if (!member) throw new TripForbiddenError();

  const other = await db.tripMember.findFirst({
    where: { tripId, userId, NOT: { id: tripMemberId } },
  });
  if (other) {
    throw new TripValidationError('Esa cuenta ya está en este viaje');
  }

  return db.tripMember.update({
    where: { id: tripMemberId },
    data: {
      userId,
      displayName: displayName?.trim() || member.displayName,
    },
    include: { trip: true },
  });
}

export async function createTripMember(
  db: Db,
  tripId: string,
  actorUserId: string,
  input: { displayName: string; tripHouseholdId?: string | null },
) {
  await requireTripOrganizer(db, tripId, actorUserId);
  const trip = await db.trip.findUniqueOrThrow({ where: { id: tripId } });
  assertTripWritable(trip.status);

  const displayName = input.displayName.trim();
  if (!displayName) throw new TripValidationError('El nombre es obligatorio');

  let tripHouseholdId: string | null = input.tripHouseholdId ?? null;
  if (tripHouseholdId) {
    const household = await db.tripHousehold.findFirst({
      where: { id: tripHouseholdId, tripId },
    });
    if (!household) throw new TripValidationError('Grupo no encontrado');
  }

  return db.tripMember.create({
    data: {
      tripId,
      displayName,
      userId: null,
      role: 'MEMBER',
      inviteStatus: 'PENDING',
      tripHouseholdId,
    },
    select: memberSelect,
  });
}

export async function deleteTripMember(
  db: Db,
  tripId: string,
  actorUserId: string,
  memberId: string,
) {
  const actor = await requireTripOrganizer(db, tripId, actorUserId);
  const trip = await db.trip.findUniqueOrThrow({ where: { id: tripId } });
  assertTripWritable(trip.status);

  const member = await db.tripMember.findFirst({ where: { id: memberId, tripId } });
  if (!member) throw new TripNotFoundError('Miembro no encontrado');
  if (member.id === actor.id) {
    throw new TripValidationError('No podés eliminarte a vos mismo');
  }
  if (member.role === 'ORGANIZER') {
    throw new TripValidationError('No se puede eliminar a un organizador');
  }

  const [paidCount, paymentCount, allocCount, settleCount] = await Promise.all([
    db.tripExpense.count({ where: { paidByMemberId: memberId } }),
    db.tripExpensePayment.count({ where: { tripMemberId: memberId } }),
    db.tripExpenseAllocation.count({ where: { tripMemberId: memberId } }),
    db.tripSettlement.count({
      where: { OR: [{ fromMemberId: memberId }, { toMemberId: memberId }] },
    }),
  ]);
  if (paidCount + paymentCount + allocCount + settleCount > 0) {
    throw new TripValidationError('No se puede eliminar: tiene gastos o liquidaciones');
  }

  // List-item assignee rows cascade on member delete.
  await db.tripMember.delete({ where: { id: memberId } });
}

export async function updateTripMember(
  db: Db,
  tripId: string,
  actorUserId: string,
  memberId: string,
  input: {
    role?: TripMemberRole;
    displayName?: string;
    tripHouseholdId?: string | null;
  },
) {
  await requireTripOrganizer(db, tripId, actorUserId);
  const member = await db.tripMember.findFirst({ where: { id: memberId, tripId } });
  if (!member) throw new TripNotFoundError('Miembro no encontrado');

  if (input.tripHouseholdId !== undefined && input.tripHouseholdId !== null) {
    const household = await db.tripHousehold.findFirst({
      where: { id: input.tripHouseholdId, tripId },
    });
    if (!household) throw new TripValidationError('Grupo no encontrado');
  }

  return db.tripMember.update({
    where: { id: memberId },
    data: {
      ...(input.role != null ? { role: input.role } : {}),
      ...(input.displayName != null ? { displayName: input.displayName.trim() } : {}),
      ...(input.tripHouseholdId !== undefined ? { tripHouseholdId: input.tripHouseholdId } : {}),
    },
    select: memberSelect,
  });
}

export async function listTripHouseholds(db: Db, tripId: string, actor: TripActor | string) {
  await requireTripMember(db, tripId, actor);
  const households = await db.tripHousehold.findMany({
    where: { tripId },
    select: householdSelect,
    orderBy: { name: 'asc' },
  });
  return [...households]
    .sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }))
    .map(serializeHousehold);
}

export async function createTripHousehold(
  db: Db,
  tripId: string,
  userId: string,
  input: { name: string; memberIds?: string[] },
) {
  await requireTripOrganizer(db, tripId, userId);
  const trip = await db.trip.findUniqueOrThrow({ where: { id: tripId } });
  assertTripWritable(trip.status);

  const name = input.name.trim();
  if (!name) throw new TripValidationError('El nombre del grupo es obligatorio');

  const household = await db.tripHousehold.create({
    data: { tripId, name },
    select: householdSelect,
  });

  if (input.memberIds && input.memberIds.length > 0) {
    const members = await db.tripMember.findMany({
      where: { tripId, id: { in: input.memberIds }, inviteStatus: { not: 'DECLINED' } },
      select: { id: true },
    });
    if (members.length !== input.memberIds.length) {
      throw new TripValidationError('Algún viajero no pertenece al viaje');
    }
    await db.tripMember.updateMany({
      where: { id: { in: members.map((m) => m.id) } },
      data: { tripHouseholdId: household.id },
    });
  }

  return serializeHousehold(household);
}

export async function updateTripHousehold(
  db: Db,
  tripId: string,
  userId: string,
  householdId: string,
  input: { name?: string },
) {
  await requireTripOrganizer(db, tripId, userId);
  const trip = await db.trip.findUniqueOrThrow({ where: { id: tripId } });
  assertTripWritable(trip.status);

  const existing = await db.tripHousehold.findFirst({ where: { id: householdId, tripId } });
  if (!existing) throw new TripNotFoundError('Grupo no encontrado');

  const data: { name?: string } = {};
  if (input.name != null) {
    const name = input.name.trim();
    if (!name) throw new TripValidationError('El nombre del grupo es obligatorio');
    data.name = name;
  }

  return serializeHousehold(
    await db.tripHousehold.update({
      where: { id: householdId },
      data,
      select: householdSelect,
    }),
  );
}

export async function deleteTripHousehold(
  db: Db,
  tripId: string,
  userId: string,
  householdId: string,
) {
  await requireTripOrganizer(db, tripId, userId);
  const trip = await db.trip.findUniqueOrThrow({ where: { id: tripId } });
  assertTripWritable(trip.status);

  const existing = await db.tripHousehold.findFirst({ where: { id: householdId, tripId } });
  if (!existing) throw new TripNotFoundError('Grupo no encontrado');

  await db.tripMember.updateMany({
    where: { tripHouseholdId: householdId },
    data: { tripHouseholdId: null },
  });
  await db.tripHousehold.delete({ where: { id: householdId } });
}

export type TripExpensePaymentInput = {
  memberId: string;
  amount: number;
};

export type TripExpenseInput = {
  amount: number;
  category: TripExpenseCategory;
  /** @deprecated Prefer `payments`; kept for single-payer clients. */
  paidByMemberId?: string;
  payments?: TripExpensePaymentInput[];
  note?: string | null;
  date: Date;
  currency?: string;
  splitMode?: SplitMode;
  assignToMemberId?: string | null;
  splitValues?: { memberId: string; value: number }[] | null;
  participantMemberIds?: string[] | null;
};

/** Roster for expense splits: joined + pending (pre-created) travellers. */
async function rosterMemberIds(db: Db, tripId: string): Promise<string[]> {
  const members = await db.tripMember.findMany({
    where: { tripId, inviteStatus: { in: ['JOINED', 'PENDING'] } },
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  return members.map((m) => m.id);
}

async function defaultTripPayerId(db: Db, tripId: string): Promise<string> {
  const members = await db.tripMember.findMany({
    where: { tripId, inviteStatus: { in: ['JOINED', 'PENDING'] } },
    select: { id: true, role: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });
  if (members.length === 0) {
    throw new TripValidationError('El viaje no tiene miembros');
  }
  const organizer = members.find((m) => m.role === 'ORGANIZER');
  return organizer?.id ?? members[0]!.id;
}

function normalizeExpensePayments(
  amount: number,
  memberIds: string[],
  input: { paidByMemberId?: string; payments?: TripExpensePaymentInput[] | null },
): { payments: TripExpensePaymentInput[]; paidByMemberId: string } {
  let payments = (input.payments ?? [])
    .map((p) => ({ memberId: p.memberId, amount: round2(p.amount) }))
    .filter((p) => p.amount > 0);

  if (payments.length === 0) {
    if (!input.paidByMemberId) {
      throw new TripValidationError('Indicá al menos un pagador');
    }
    payments = [{ memberId: input.paidByMemberId, amount: round2(amount) }];
  }

  const seen = new Set<string>();
  for (const p of payments) {
    if (!memberIds.includes(p.memberId)) {
      throw new TripValidationError('Un pagador no pertenece al viaje');
    }
    if (seen.has(p.memberId)) {
      throw new TripValidationError('Cada miembro puede aparecer una sola vez en los pagadores');
    }
    seen.add(p.memberId);
  }

  const sum = round2(payments.reduce((s, p) => s + p.amount, 0));
  if (Math.abs(sum - round2(amount)) > 0.01) {
    throw new TripValidationError('La suma de lo pagado debe coincidir con el monto del gasto');
  }

  // Fix rounding drift onto the largest payment
  const drift = round2(round2(amount) - sum);
  if (drift !== 0) {
    const idx = payments.reduce(
      (best, p, i, arr) => (p.amount > arr[best]!.amount ? i : best),
      0,
    );
    payments[idx] = {
      ...payments[idx]!,
      amount: round2(payments[idx]!.amount + drift),
    };
  }

  const primary = [...payments].sort((a, b) => b.amount - a.amount || a.memberId.localeCompare(b.memberId))[0]!;
  return { payments, paidByMemberId: primary.memberId };
}

function scalePaymentsToAmount(
  payments: TripExpensePaymentInput[],
  newAmount: number,
  fallbackMemberId: string,
): TripExpensePaymentInput[] {
  const target = round2(newAmount);
  if (!(target > 0)) return [];
  const oldTotal = round2(payments.reduce((s, p) => s + p.amount, 0));
  if (payments.length === 0 || oldTotal <= 0) {
    return [{ memberId: fallbackMemberId, amount: target }];
  }
  const scaled = payments.map((p) => ({
    memberId: p.memberId,
    amount: round2((p.amount / oldTotal) * target),
  }));
  const sum = round2(scaled.reduce((s, p) => s + p.amount, 0));
  const drift = round2(target - sum);
  if (drift !== 0) {
    const idx = scaled.reduce(
      (best, p, i, arr) => (p.amount > arr[best]!.amount ? i : best),
      0,
    );
    scaled[idx] = { ...scaled[idx]!, amount: round2(scaled[idx]!.amount + drift) };
  }
  return scaled.filter((p) => p.amount > 0);
}

function buildTripAllocations(
  input: TripExpenseInput & { paidByMemberId: string },
  memberIds: string[],
) {
  const participants =
    input.participantMemberIds && input.participantMemberIds.length > 0
      ? input.participantMemberIds.filter((id) => memberIds.includes(id))
      : memberIds;
  if (participants.length === 0) {
    throw new TripValidationError('Se requiere al menos un participante');
  }

  const splitMode = input.splitMode ?? 'EQUAL';
  const splitValues = (input.splitValues ?? []).map((e) => ({
    userId: e.memberId,
    value: e.value,
  }));

  try {
    return buildPurchaseAllocations({
      scope: 'HOUSEHOLD',
      netAmount: input.amount,
      userId: input.paidByMemberId,
      memberIds: participants,
      splitMode,
      assignToUserId: input.assignToMemberId ?? undefined,
      splitValues: splitValues.length > 0 ? splitValues : undefined,
    }).map((a) => ({ tripMemberId: a.userId, amount: a.amount }));
  } catch (error) {
    throw new TripValidationError(error instanceof Error ? error.message : 'Reparto inválido');
  }
}

export async function listTripExpenses(db: Db, tripId: string, actor: TripActor | string) {
  await requireTripMember(db, tripId, actor);
  const expenses = await db.tripExpense.findMany({
    where: { tripId },
    include: expenseInclude,
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
  });
  return expenses.map(serializeExpense);
}

export async function getTripExpense(db: Db, tripId: string, expenseId: string, actor: TripActor | string) {
  await requireTripMember(db, tripId, actor);
  const expense = await db.tripExpense.findFirst({
    where: { id: expenseId, tripId },
    include: expenseInclude,
  });
  if (!expense) throw new TripNotFoundError('Gasto no encontrado');

  const linked = await db.tripAccommodation.findFirst({
    where: { expenseId, tripId },
    select: { id: true, label: true, address: true },
  });

  return {
    ...serializeExpense(expense),
    accommodation: linked
      ? { id: linked.id, label: linked.label, address: linked.address }
      : null,
  };
}

function serializeExpense(expense: {
  id: string;
  tripId: string;
  paidByMemberId: string;
  amount: unknown;
  category: TripExpenseCategory;
  note: string | null;
  date: Date;
  currency: string;
  splitMode: SplitMode;
  exportedPurchaseId: string | null;
  createdAt: Date;
  updatedAt: Date;
  paidByMember: {
    id: string;
    displayName: string;
    userId: string | null;
    role: TripMemberRole;
  };
  payments: Array<{
    id: string;
    tripMemberId: string;
    amount: unknown;
    tripMember: { id: string; displayName: string; userId: string | null };
  }>;
  allocations: Array<{
    id: string;
    tripMemberId: string;
    amount: unknown;
    tripMember: { id: string; displayName: string; userId: string | null };
  }>;
}) {
  return {
    id: expense.id,
    tripId: expense.tripId,
    paidByMemberId: expense.paidByMemberId,
    paidByMember: {
      id: expense.paidByMember.id,
      displayName: expense.paidByMember.displayName,
      userId: expense.paidByMember.userId,
    },
    amount: toNum(expense.amount),
    category: expense.category,
    note: expense.note,
    date: expense.date,
    currency: expense.currency,
    splitMode: expense.splitMode,
    exportedPurchaseId: expense.exportedPurchaseId,
    createdAt: expense.createdAt,
    updatedAt: expense.updatedAt,
    payments: expense.payments.map((p) => ({
      id: p.id,
      tripMemberId: p.tripMemberId,
      amount: toNum(p.amount),
      displayName: p.tripMember.displayName,
      userId: p.tripMember.userId,
    })),
    allocations: expense.allocations.map((a) => ({
      id: a.id,
      tripMemberId: a.tripMemberId,
      amount: toNum(a.amount),
      displayName: a.tripMember.displayName,
      userId: a.tripMember.userId,
    })),
  };
}

export async function createTripExpense(db: Db, tripId: string, actor: TripActor | string, input: TripExpenseInput) {
  const me = await requireTripMember(db, tripId, actor);
  assertTripWritable(me.trip.status);

  if (!(input.amount > 0)) throw new TripValidationError('El monto debe ser mayor a 0');
  const memberIds = await rosterMemberIds(db, tripId);
  const { payments, paidByMemberId } = normalizeExpensePayments(input.amount, memberIds, input);
  const allocations = buildTripAllocations({ ...input, paidByMemberId }, memberIds);

  const expense = await db.tripExpense.create({
    data: {
      tripId,
      paidByMemberId,
      amount: input.amount,
      category: input.category,
      note: input.note?.trim() || null,
      date: input.date,
      currency: input.currency ?? 'ARS',
      splitMode: input.splitMode ?? 'EQUAL',
      payments: {
        create: payments.map((p) => ({ tripMemberId: p.memberId, amount: p.amount })),
      },
      allocations: { create: allocations },
    },
    include: expenseInclude,
  });

  if (me.trip.status === 'PLANNING') {
    await db.trip.update({ where: { id: tripId }, data: { status: 'ACTIVE' } });
  }

  return serializeExpense(expense);
}

export async function updateTripExpense(
  db: Db,
  tripId: string,
  expenseId: string,
  actor: TripActor | string,
  input: Partial<TripExpenseInput>,
) {
  const me = await requireTripMember(db, tripId, actor);
  assertTripWritable(me.trip.status);

  const existing = await db.tripExpense.findFirst({
    where: { id: expenseId, tripId },
    include: { payments: true },
  });
  if (!existing) throw new TripNotFoundError('Gasto no encontrado');

  const memberIds = await rosterMemberIds(db, tripId);
  const amount = input.amount ?? toNum(existing.amount);

  let paymentSource: { paidByMemberId?: string; payments?: TripExpensePaymentInput[] | null };
  if (input.payments != null) {
    paymentSource = { payments: input.payments, paidByMemberId: input.paidByMemberId };
  } else if (input.paidByMemberId != null && input.payments === undefined) {
    // Explicit single-payer update without payments array
    paymentSource = { paidByMemberId: input.paidByMemberId };
  } else {
    paymentSource = {
      payments: existing.payments.map((p) => ({
        memberId: p.tripMemberId,
        amount: toNum(p.amount),
      })),
      paidByMemberId: existing.paidByMemberId,
    };
    if (input.amount != null && round2(input.amount) !== round2(toNum(existing.amount))) {
      paymentSource = {
        payments: scalePaymentsToAmount(
          paymentSource.payments ?? [],
          amount,
          existing.paidByMemberId,
        ),
      };
    }
  }

  const { payments, paidByMemberId } = normalizeExpensePayments(amount, memberIds, paymentSource);

  const merged: TripExpenseInput & { paidByMemberId: string } = {
    amount,
    category: input.category ?? existing.category,
    paidByMemberId,
    payments,
    note: input.note !== undefined ? input.note : existing.note,
    date: input.date ?? existing.date,
    currency: input.currency ?? existing.currency,
    splitMode: input.splitMode ?? (existing.splitMode as SplitMode),
    assignToMemberId: input.assignToMemberId,
    splitValues: input.splitValues,
    participantMemberIds: input.participantMemberIds,
  };

  if (!(merged.amount > 0)) throw new TripValidationError('El monto debe ser mayor a 0');

  const allocations = buildTripAllocations(merged, memberIds);

  await db.tripExpensePayment.deleteMany({ where: { tripExpenseId: expenseId } });
  await db.tripExpenseAllocation.deleteMany({ where: { tripExpenseId: expenseId } });
  const expense = await db.tripExpense.update({
    where: { id: expenseId },
    data: {
      paidByMemberId: merged.paidByMemberId,
      amount: merged.amount,
      category: merged.category,
      note: merged.note?.trim() || null,
      date: merged.date,
      currency: merged.currency ?? 'ARS',
      splitMode: merged.splitMode ?? 'EQUAL',
      payments: {
        create: payments.map((p) => ({ tripMemberId: p.memberId, amount: p.amount })),
      },
      allocations: { create: allocations },
    },
    include: expenseInclude,
  });

  const linked = await db.tripAccommodation.findFirst({ where: { expenseId, tripId } });
  if (linked) {
    if (merged.category !== 'ALOJAMIENTO') {
      await db.tripAccommodation.update({
        where: { id: linked.id },
        data: { expenseId: null, amount: null },
      });
    } else {
      await db.tripAccommodation.update({
        where: { id: linked.id },
        data: {
          amount: merged.amount,
          ...(input.note !== undefined ? { label: merged.note?.trim() || linked.label } : {}),
        },
      });
    }
  }

  return serializeExpense(expense);
}

export async function deleteTripExpense(db: Db, tripId: string, expenseId: string, actor: TripActor | string) {
  const me = await requireTripMember(db, tripId, actor);
  assertTripWritable(me.trip.status);
  const existing = await db.tripExpense.findFirst({ where: { id: expenseId, tripId } });
  if (!existing) throw new TripNotFoundError('Gasto no encontrado');

  const linked = await db.tripAccommodation.findFirst({ where: { expenseId, tripId } });
  if (linked) {
    await db.tripAccommodation.update({
      where: { id: linked.id },
      data: { expenseId: null, amount: null },
    });
  }
  await db.tripExpense.delete({ where: { id: expenseId } });
}

export interface TripBalanceMember {
  memberId: string;
  displayName: string;
  userId: string | null;
  tripHouseholdId: string | null;
  paid: number;
  share: number;
  balance: number;
}

export interface TripBalanceUnit {
  unitId: string;
  kind: 'HOUSEHOLD' | 'MEMBER';
  displayName: string;
  tripHouseholdId: string | null;
  memberIds: string[];
  /** Representative member used when recording TripSettlement rows. */
  representativeMemberId: string;
  paid: number;
  share: number;
  balance: number;
}

export interface TripBalanceTransfer {
  fromUnitId: string;
  fromName: string;
  toUnitId: string;
  toName: string;
  amount: number;
  /** Representative members for persisting TripSettlement. */
  fromMemberId: string;
  toMemberId: string;
}

export interface TripSettlementRow {
  id: string;
  fromMemberId: string;
  fromName: string;
  toMemberId: string;
  toName: string;
  amount: number;
  note: string | null;
  settledAt: Date;
}

export interface TripBalanceResult {
  perMember: TripBalanceMember[];
  perUnit: TripBalanceUnit[];
  transfers: TripBalanceTransfer[];
  settlements: TripSettlementRow[];
}

function settlementUnitId(member: { id: string; tripHouseholdId: string | null }): string {
  return member.tripHouseholdId ? `household:${member.tripHouseholdId}` : `member:${member.id}`;
}

function pickRepresentative(
  members: Array<{ id: string; inviteStatus: string; createdAt: Date }>,
): string {
  const sorted = [...members].sort((a, b) => {
    const aJoined = a.inviteStatus === 'JOINED' ? 0 : 1;
    const bJoined = b.inviteStatus === 'JOINED' ? 0 : 1;
    if (aJoined !== bJoined) return aJoined - bJoined;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });
  return sorted[0]!.id;
}

export async function computeTripBalance(db: Db, tripId: string): Promise<TripBalanceResult> {
  const [members, households, expenses, settlementRows] = await Promise.all([
    db.tripMember.findMany({
      where: { tripId, inviteStatus: { in: ['JOINED', 'PENDING'] } },
      select: memberSelect,
    }),
    db.tripHousehold.findMany({
      where: { tripId },
      select: householdSelect,
    }),
    db.tripExpense.findMany({
      where: { tripId },
      include: { allocations: true, payments: true },
    }),
    db.tripSettlement.findMany({
      where: { tripId },
      include: {
        fromMember: { select: memberSelect },
        toMember: { select: memberSelect },
      },
      orderBy: { settledAt: 'desc' },
    }),
  ]);

  const householdNames = new Map(households.map((h) => [h.id, h.name]));
  const paidBy = new Map<string, number>();
  const shareBy = new Map<string, number>();

  for (const m of members) {
    paidBy.set(m.id, 0);
    shareBy.set(m.id, 0);
  }

  for (const expense of expenses) {
    for (const payment of expense.payments) {
      paidBy.set(
        payment.tripMemberId,
        round2((paidBy.get(payment.tripMemberId) ?? 0) + toNum(payment.amount)),
      );
    }
    for (const alloc of expense.allocations) {
      shareBy.set(alloc.tripMemberId, round2((shareBy.get(alloc.tripMemberId) ?? 0) + toNum(alloc.amount)));
    }
  }

  const expensePerMember: TripBalanceMember[] = members.map((m) => {
    const paid = round2(paidBy.get(m.id) ?? 0);
    const share = round2(shareBy.get(m.id) ?? 0);
    return {
      memberId: m.id,
      displayName: m.displayName,
      userId: m.userId,
      tripHouseholdId: m.tripHouseholdId,
      paid,
      share,
      balance: round2(paid - share),
    };
  });

  const unitMembers = new Map<string, typeof members>();
  for (const m of members) {
    const unitId = settlementUnitId(m);
    const list = unitMembers.get(unitId) ?? [];
    list.push(m);
    unitMembers.set(unitId, list);
  }

  const units: TripBalanceUnit[] = [];
  for (const [unitId, unitMemberList] of unitMembers) {
    const first = unitMemberList[0]!;
    const isHousehold = Boolean(first.tripHouseholdId);
    const paid = round2(unitMemberList.reduce((s, m) => s + (paidBy.get(m.id) ?? 0), 0));
    const share = round2(unitMemberList.reduce((s, m) => s + (shareBy.get(m.id) ?? 0), 0));
    units.push({
      unitId,
      kind: isHousehold ? 'HOUSEHOLD' : 'MEMBER',
      displayName: isHousehold
        ? (householdNames.get(first.tripHouseholdId!) ?? 'Grupo')
        : first.displayName,
      tripHouseholdId: first.tripHouseholdId,
      memberIds: unitMemberList.map((m) => m.id),
      representativeMemberId: pickRepresentative(unitMemberList),
      paid,
      share,
      balance: round2(paid - share),
    });
  }

  const memberToUnit = new Map<string, string>();
  for (const unit of units) {
    for (const mid of unit.memberIds) memberToUnit.set(mid, unit.unitId);
  }
  for (const s of settlementRows) {
    if (!memberToUnit.has(s.fromMemberId) && s.fromMember) {
      memberToUnit.set(s.fromMemberId, settlementUnitId(s.fromMember));
    }
    if (!memberToUnit.has(s.toMemberId) && s.toMember) {
      memberToUnit.set(s.toMemberId, settlementUnitId(s.toMember));
    }
  }

  const offsets = settlementRows.map((s) => ({
    fromUserId: memberToUnit.get(s.fromMemberId) ?? settlementUnitId(s.fromMember),
    toUserId: memberToUnit.get(s.toMemberId) ?? settlementUnitId(s.toMember),
    amount: toNum(s.amount),
  }));

  const adjusted = applySettlementOffsets(
    units.map((u) => ({ userId: u.unitId, balance: u.balance })),
    offsets,
  );
  const balanceByUnit = new Map(adjusted.map((b) => [b.userId, b.balance]));

  const perUnit = units
    .map((u) => ({
      ...u,
      balance: round2(balanceByUnit.get(u.unitId) ?? u.balance),
    }))
    .sort((a, b) => b.balance - a.balance);

  const unitById = new Map(perUnit.map((u) => [u.unitId, u]));

  const transfers = computeSettleTransfers(
    perUnit.map((u) => ({ userId: u.unitId, balance: u.balance })),
  ).map((t) => {
    const from = unitById.get(t.fromUserId)!;
    const to = unitById.get(t.toUserId)!;
    return {
      fromUnitId: from.unitId,
      fromName: from.displayName,
      toUnitId: to.unitId,
      toName: to.displayName,
      amount: t.amount,
      fromMemberId: from.representativeMemberId,
      toMemberId: to.representativeMemberId,
    };
  });

  const perMember = expensePerMember.sort((a, b) => b.balance - a.balance);

  const settlements: TripSettlementRow[] = settlementRows.map((s) => ({
    id: s.id,
    fromMemberId: s.fromMemberId,
    fromName: s.fromMember.displayName,
    toMemberId: s.toMemberId,
    toName: s.toMember.displayName,
    amount: toNum(s.amount),
    note: s.note,
    settledAt: s.settledAt,
  }));

  return { perMember, perUnit, transfers, settlements };
}

export async function computeCategoryTotals(db: Db, tripId: string) {
  const expenses = await db.tripExpense.findMany({
    where: { tripId },
    select: { category: true, amount: true },
  });
  const byCat = new Map<TripExpenseCategory, number>();
  for (const e of expenses) {
    byCat.set(e.category, round2((byCat.get(e.category) ?? 0) + toNum(e.amount)));
  }
  const total = [...byCat.values()].reduce((s, v) => s + v, 0);
  return [...byCat.entries()]
    .map(([category, amount]) => ({
      category,
      total: amount,
      percent: total > 0 ? round2((amount / total) * 100) : 0,
    }))
    .sort((a, b) => b.total - a.total);
}

export async function settleTrip(
  db: Db,
  tripId: string,
  actor: TripActor | string,
  opts?: { note?: string | null; close?: boolean },
) {
  await requireTripMember(db, tripId, actor);
  const trip = await db.trip.findUniqueOrThrow({ where: { id: tripId } });
  assertTripWritable(trip.status);

  const current = await computeTripBalance(db, tripId);
  if (current.transfers.length === 0 && !opts?.close) {
    throw new TripValidationError('Ya están a mano');
  }

  if (current.transfers.length > 0) {
    await db.tripSettlement.createMany({
      data: current.transfers.map((t) => ({
        tripId,
        fromMemberId: t.fromMemberId,
        toMemberId: t.toMemberId,
        amount: t.amount,
        note: opts?.note?.trim() || null,
      })),
    });
  }

  if (opts?.close !== false) {
    await db.trip.update({ where: { id: tripId }, data: { status: 'CLOSED' } });
  }

  return computeTripBalance(db, tripId);
}

// --- List items ---

const listItemInclude = {
  assignees: {
    include: { member: { select: memberSelect } },
    orderBy: { member: { displayName: 'asc' as const } },
  },
} as const;

function serializeListItem<T extends { assignees: Array<{ member: unknown }> }>(item: T) {
  const { assignees, ...rest } = item;
  return {
    ...rest,
    assignees: assignees.map((a) => a.member),
  };
}

async function resolveListAssignees(
  db: Db,
  tripId: string,
  input: {
    assignToAll?: boolean;
    assigneeMemberIds?: string[];
    /** @deprecated single-assignee API; mapped when assigneeMemberIds omitted */
    assigneeMemberId?: string | null;
  },
): Promise<{ assignToAll: boolean; memberIds: string[] }> {
  if (input.assignToAll) {
    return { assignToAll: true, memberIds: [] };
  }

  let memberIds = input.assigneeMemberIds;
  if (memberIds === undefined && input.assigneeMemberId !== undefined) {
    memberIds = input.assigneeMemberId ? [input.assigneeMemberId] : [];
  }
  if (memberIds === undefined) {
    return { assignToAll: false, memberIds: [] };
  }

  const unique = [...new Set(memberIds)];
  if (unique.length === 0) {
    return { assignToAll: false, memberIds: [] };
  }

  const count = await db.tripMember.count({
    where: { tripId, id: { in: unique } },
  });
  if (count !== unique.length) {
    throw new TripValidationError('Asignación inválida');
  }
  return { assignToAll: false, memberIds: unique };
}

export async function listTripListItems(
  db: Db,
  tripId: string,
  actor: TripActor | string,
  type?: TripListItemType,
) {
  await requireTripMember(db, tripId, actor);
  const items = await db.tripListItem.findMany({
    where: { tripId, ...(type ? { type } : {}) },
    include: listItemInclude,
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
  });
  return items.map(serializeListItem);
}

export async function createTripListItem(
  db: Db,
  tripId: string,
  actor: TripActor | string,
  input: {
    type: TripListItemType;
    title: string;
    notes?: string | null;
    quantity?: number | null;
    assignToAll?: boolean;
    assigneeMemberIds?: string[];
    assigneeMemberId?: string | null;
    dayDate?: Date | null;
  },
) {
  const me = await requireTripMember(db, tripId, actor);
  assertTripWritable(me.trip.status);
  const title = input.title.trim();
  if (!title) throw new TripValidationError('El título es obligatorio');

  const { assignToAll, memberIds } = await resolveListAssignees(db, tripId, input);

  const item = await db.tripListItem.create({
    data: {
      tripId,
      type: input.type,
      title,
      notes: input.notes?.trim() || null,
      quantity: input.quantity ?? null,
      assignToAll,
      dayDate: input.dayDate ?? null,
      ...(memberIds.length > 0
        ? { assignees: { create: memberIds.map((memberId) => ({ memberId })) } }
        : {}),
    },
    include: listItemInclude,
  });
  return serializeListItem(item);
}

export async function updateTripListItem(
  db: Db,
  tripId: string,
  itemId: string,
  actor: TripActor | string,
  input: {
    title?: string;
    notes?: string | null;
    quantity?: number | null;
    assignToAll?: boolean;
    assigneeMemberIds?: string[];
    assigneeMemberId?: string | null;
    status?: 'PENDING' | 'DONE';
    dayDate?: Date | null;
    type?: TripListItemType;
  },
) {
  const me = await requireTripMember(db, tripId, actor);
  assertTripWritable(me.trip.status);
  const existing = await db.tripListItem.findFirst({ where: { id: itemId, tripId } });
  if (!existing) throw new TripNotFoundError('Ítem no encontrado');

  const assigneesTouched =
    input.assignToAll !== undefined ||
    input.assigneeMemberIds !== undefined ||
    input.assigneeMemberId !== undefined;

  let assigneeData: { assignToAll: boolean; memberIds: string[] } | null = null;
  if (assigneesTouched) {
    assigneeData = await resolveListAssignees(db, tripId, input);
  }

  const item = await db.tripListItem.update({
    where: { id: itemId },
    data: {
      ...(input.title != null ? { title: input.title.trim() } : {}),
      ...(input.notes !== undefined ? { notes: input.notes?.trim() || null } : {}),
      ...(input.quantity !== undefined ? { quantity: input.quantity } : {}),
      ...(input.status != null ? { status: input.status } : {}),
      ...(input.dayDate !== undefined ? { dayDate: input.dayDate } : {}),
      ...(input.type != null ? { type: input.type } : {}),
      ...(assigneeData
        ? {
            assignToAll: assigneeData.assignToAll,
            assignees: {
              deleteMany: {},
              ...(assigneeData.memberIds.length > 0
                ? {
                    create: assigneeData.memberIds.map((memberId) => ({ memberId })),
                  }
                : {}),
            },
          }
        : {}),
    },
    include: listItemInclude,
  });

  return serializeListItem(item);
}

export async function deleteTripListItem(db: Db, tripId: string, itemId: string, actor: TripActor | string) {
  const me = await requireTripMember(db, tripId, actor);
  assertTripWritable(me.trip.status);
  const existing = await db.tripListItem.findFirst({ where: { id: itemId, tripId } });
  if (!existing) throw new TripNotFoundError('Ítem no encontrado');
  await db.tripListItem.delete({ where: { id: itemId } });
}

// --- Accommodation ---

/**
 * Keep TripAccommodation.amount in sync with a linked Alojamiento TripExpense.
 * Creates/updates equal-split expense among PENDING+JOINED; deletes unexported expense when cost cleared.
 */
async function syncAccommodationExpense(
  db: Db,
  tripId: string,
  acc: {
    id: string;
    expenseId: string | null;
    amount: unknown;
    label: string | null;
    checkIn: Date | null;
  },
  tripCurrency: string,
) {
  const cost = acc.amount == null ? null : round2(toNum(acc.amount));
  const note = acc.label?.trim() || 'Alojamiento';
  const date = acc.checkIn ?? new Date();

  if (cost == null || cost <= 0) {
    if (acc.expenseId) {
      const linked = await db.tripExpense.findFirst({ where: { id: acc.expenseId, tripId } });
      if (linked && !linked.exportedPurchaseId) {
        await db.tripExpense.delete({ where: { id: linked.id } });
      } else if (linked?.exportedPurchaseId) {
        // Keep exported expense; just detach so we don't mutate household history oddly.
        await db.tripAccommodation.update({
          where: { id: acc.id },
          data: { expenseId: null, amount: null },
        });
        return db.tripAccommodation.findUniqueOrThrow({ where: { id: acc.id } });
      }
    }
    return db.tripAccommodation.update({
      where: { id: acc.id },
      data: { expenseId: null, amount: null },
    });
  }

  const memberIds = await rosterMemberIds(db, tripId);
  const payerId = await defaultTripPayerId(db, tripId);
  const equalAllocations = buildTripAllocations(
    {
      amount: cost,
      category: 'ALOJAMIENTO',
      paidByMemberId: payerId,
      date,
      splitMode: 'EQUAL',
      participantMemberIds: memberIds,
    },
    memberIds,
  );

  if (acc.expenseId) {
    const existing = await db.tripExpense.findFirst({
      where: { id: acc.expenseId, tripId },
      include: { payments: true },
    });
    if (!existing) {
      // Stale FK — recreate
      await db.tripAccommodation.update({ where: { id: acc.id }, data: { expenseId: null } });
    } else {
      const scaled = scalePaymentsToAmount(
        existing.payments.map((p) => ({ memberId: p.tripMemberId, amount: toNum(p.amount) })),
        cost,
        existing.paidByMemberId,
      );
      const { payments, paidByMemberId } = normalizeExpensePayments(cost, memberIds, {
        payments: scaled,
      });

      // Preserve custom split if user edited from Gastos; only rebuild when still EQUAL
      let allocations = equalAllocations;
      if (existing.splitMode !== 'EQUAL') {
        const existingAllocs = await db.tripExpenseAllocation.findMany({
          where: { tripExpenseId: existing.id },
        });
        allocations = scalePaymentsToAmount(
          existingAllocs.map((a) => ({ memberId: a.tripMemberId, amount: toNum(a.amount) })),
          cost,
          payerId,
        ).map((p) => ({ tripMemberId: p.memberId, amount: p.amount }));
        if (allocations.length === 0) allocations = equalAllocations;
      }

      await db.tripExpensePayment.deleteMany({ where: { tripExpenseId: existing.id } });
      await db.tripExpenseAllocation.deleteMany({ where: { tripExpenseId: existing.id } });
      await db.tripExpense.update({
        where: { id: existing.id },
        data: {
          paidByMemberId,
          amount: cost,
          category: 'ALOJAMIENTO',
          note,
          date,
          currency: existing.currency || tripCurrency,
          payments: {
            create: payments.map((p) => ({ tripMemberId: p.memberId, amount: p.amount })),
          },
          allocations: { create: allocations },
        },
      });
      return db.tripAccommodation.update({
        where: { id: acc.id },
        data: { amount: cost, expenseId: existing.id },
      });
    }
  }

  const expense = await db.tripExpense.create({
    data: {
      tripId,
      paidByMemberId: payerId,
      amount: cost,
      category: 'ALOJAMIENTO',
      note,
      date,
      currency: tripCurrency,
      splitMode: 'EQUAL',
      payments: { create: [{ tripMemberId: payerId, amount: cost }] },
      allocations: { create: equalAllocations },
    },
  });

  const trip = await db.trip.findUniqueOrThrow({ where: { id: tripId }, select: { status: true } });
  if (trip.status === 'PLANNING') {
    await db.trip.update({ where: { id: tripId }, data: { status: 'ACTIVE' } });
  }

  return db.tripAccommodation.update({
    where: { id: acc.id },
    data: { amount: cost, expenseId: expense.id },
  });
}

export async function upsertTripAccommodation(
  db: Db,
  tripId: string,
  actor: TripActor | string,
  input: {
    label?: string | null;
    address?: string | null;
    checkIn?: Date | null;
    checkOut?: Date | null;
    checkInTime?: string | null;
    checkOutTime?: string | null;
    amount?: number | null;
    link?: string | null;
    notes?: string | null;
  },
) {
  const me = await requireTripMember(db, tripId, actor);
  assertTripWritable(me.trip.status);

  if (input.amount != null && !(input.amount >= 0)) {
    throw new TripValidationError('El costo debe ser mayor o igual a 0');
  }

  const data = {
    label: input.label?.trim() || null,
    address: input.address?.trim() || null,
    checkIn: input.checkIn ?? null,
    checkOut: input.checkOut ?? null,
    checkInTime: input.checkInTime?.trim() || null,
    checkOutTime: input.checkOutTime?.trim() || null,
    amount: input.amount == null || input.amount === 0 ? null : round2(input.amount),
    link: input.link?.trim() || null,
    notes: input.notes?.trim() || null,
  };

  const row = await db.tripAccommodation.upsert({
    where: { tripId },
    create: { tripId, ...data },
    update: data,
  });

  const synced = await syncAccommodationExpense(db, tripId, row, me.trip.baseCurrency);
  return serializeAccommodation(synced);
}

export async function getTripAccommodation(db: Db, tripId: string, actor: TripActor | string) {
  await requireTripMember(db, tripId, actor);
  const row = await db.tripAccommodation.findUnique({ where: { tripId } });
  if (!row) return null;

  // Lazy backfill: stay cost without linked expense (pre-migration data)
  if (row.amount != null && toNum(row.amount) > 0 && !row.expenseId) {
    const trip = await db.trip.findUniqueOrThrow({
      where: { id: tripId },
      select: { baseCurrency: true, status: true },
    });
    if (trip.status !== 'CLOSED') {
      const synced = await syncAccommodationExpense(db, tripId, row, trip.baseCurrency);
      return serializeAccommodation(synced);
    }
  }

  return serializeAccommodation(row);
}
