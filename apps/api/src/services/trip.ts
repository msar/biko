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
  createdAt: true,
} as const;

const expenseInclude = {
  paidByMember: { select: memberSelect },
  allocations: {
    include: { tripMember: { select: memberSelect } },
    orderBy: { tripMemberId: 'asc' as const },
  },
} as const;

export async function requireTripMember(db: Db, tripId: string, userId: string) {
  const member = await db.tripMember.findFirst({
    where: { tripId, userId, inviteStatus: 'JOINED' },
    include: { trip: true },
  });
  if (!member) throw new TripForbiddenError();
  return member;
}

export async function requireTripOrganizer(db: Db, tripId: string, userId: string) {
  const member = await requireTripMember(db, tripId, userId);
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

  return db.trip.create({
    data: {
      createdByUserId: userId,
      name,
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

export async function getTripHub(db: Db, tripId: string, userId: string, householdId: string) {
  const me = await requireTripMember(db, tripId, userId);
  const trip = await db.trip.findUnique({
    where: { id: tripId },
    include: {
      members: {
        where: { inviteStatus: { not: 'DECLINED' } },
        select: memberSelect,
        orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
      },
      invites: { orderBy: { createdAt: 'desc' }, take: 1 },
      accommodation: true,
      exportBatches: {
        where: { householdId },
        take: 1,
      },
    },
  });
  if (!trip) throw new TripNotFoundError();

  const balance = await computeTripBalance(db, tripId);
  const categoryTotals = await computeCategoryTotals(db, tripId);
  const totalSpent = round2(categoryTotals.reduce((s, c) => s + c.total, 0));

  const isOrganizer = me.role === 'ORGANIZER';
  const alreadyExported = trip.exportBatches.length > 0 || trip.exportHouseholdId === householdId;
  const canExport =
    isOrganizer && trip.status === 'CLOSED' && !alreadyExported && Boolean(householdId);

  return {
    ...serializeTrip(trip),
    myMember: serializeMember(me),
    isOrganizer,
    canExport,
    alreadyExported,
    isGuestSession: false,
    balance: {
      perMember: balance.perMember,
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
  createdAt: Date;
}) {
  return {
    id: m.id,
    tripId: m.tripId,
    userId: m.userId,
    displayName: m.displayName,
    role: m.role,
    inviteStatus: m.inviteStatus,
    createdAt: m.createdAt,
  };
}

function serializeTrip(trip: {
  id: string;
  createdByUserId: string;
  name: string;
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
    createdAt: Date;
  }>;
  invites: Array<{ id: string; code: string; expiresAt: Date | null; createdAt: Date }>;
  accommodation: {
    id: string;
    label: string | null;
    address: string | null;
    checkIn: Date | null;
    checkOut: Date | null;
    link: string | null;
    notes: string | null;
  } | null;
}) {
  return {
    id: trip.id,
    createdByUserId: trip.createdByUserId,
    name: trip.name,
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
    members: trip.members.map(serializeMember),
    inviteCode: trip.invites[0]?.code ?? null,
    accommodation: trip.accommodation,
  };
}

export async function updateTrip(
  db: Db,
  tripId: string,
  userId: string,
  input: {
    name?: string;
    destination?: string | null;
    startDate?: Date | null;
    endDate?: Date | null;
    status?: TripStatus;
  },
) {
  const me = await requireTripMember(db, tripId, userId);
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
      members: { where: { inviteStatus: { not: 'DECLINED' } }, select: memberSelect },
      invites: { orderBy: { createdAt: 'desc' }, take: 1 },
      accommodation: true,
    },
  });
}

export async function closeTrip(db: Db, tripId: string, userId: string) {
  await requireTripOrganizer(db, tripId, userId);
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
  return invite;
}

export async function joinTripByCode(
  db: Db,
  userId: string,
  userName: string,
  code: string,
  displayName?: string | null,
) {
  const invite = await db.tripInvite.findUnique({
    where: { code: code.trim() },
    include: { trip: true },
  });
  if (!invite) throw new TripNotFoundError('Código de invitación inválido');
  if (invite.expiresAt && invite.expiresAt < new Date()) {
    throw new TripValidationError('La invitación expiró');
  }
  if (invite.trip.status === 'CLOSED') {
    throw new TripValidationError('El viaje ya está cerrado');
  }

  const existing = await db.tripMember.findFirst({
    where: { tripId: invite.tripId, userId },
  });
  if (existing) {
    if (existing.inviteStatus !== 'JOINED') {
      return db.tripMember.update({
        where: { id: existing.id },
        data: {
          inviteStatus: 'JOINED',
          displayName: displayName?.trim() || existing.displayName || userName,
        },
        include: { trip: true },
      });
    }
    return { ...existing, trip: invite.trip };
  }

  return db.tripMember.create({
    data: {
      tripId: invite.tripId,
      userId,
      displayName: displayName?.trim() || userName,
      role: 'MEMBER',
      inviteStatus: 'JOINED',
    },
    include: { trip: true },
  });
}

export async function updateTripMember(
  db: Db,
  tripId: string,
  actorUserId: string,
  memberId: string,
  input: { role?: TripMemberRole; displayName?: string },
) {
  await requireTripOrganizer(db, tripId, actorUserId);
  const member = await db.tripMember.findFirst({ where: { id: memberId, tripId } });
  if (!member) throw new TripNotFoundError('Miembro no encontrado');

  return db.tripMember.update({
    where: { id: memberId },
    data: {
      ...(input.role != null ? { role: input.role } : {}),
      ...(input.displayName != null ? { displayName: input.displayName.trim() } : {}),
    },
    select: memberSelect,
  });
}

export type TripExpenseInput = {
  amount: number;
  category: TripExpenseCategory;
  paidByMemberId: string;
  note?: string | null;
  date: Date;
  currency?: string;
  splitMode?: SplitMode;
  assignToMemberId?: string | null;
  splitValues?: { memberId: string; value: number }[] | null;
  participantMemberIds?: string[] | null;
};

async function joinedMemberIds(db: Db, tripId: string): Promise<string[]> {
  const members = await db.tripMember.findMany({
    where: { tripId, inviteStatus: 'JOINED' },
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  return members.map((m) => m.id);
}

function buildTripAllocations(input: TripExpenseInput, memberIds: string[]) {
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

export async function listTripExpenses(db: Db, tripId: string, userId: string) {
  await requireTripMember(db, tripId, userId);
  const expenses = await db.tripExpense.findMany({
    where: { tripId },
    include: expenseInclude,
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
  });
  return expenses.map(serializeExpense);
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
    allocations: expense.allocations.map((a) => ({
      id: a.id,
      tripMemberId: a.tripMemberId,
      amount: toNum(a.amount),
      displayName: a.tripMember.displayName,
      userId: a.tripMember.userId,
    })),
  };
}

export async function createTripExpense(db: Db, tripId: string, userId: string, input: TripExpenseInput) {
  const me = await requireTripMember(db, tripId, userId);
  assertTripWritable(me.trip.status);

  if (!(input.amount > 0)) throw new TripValidationError('El monto debe ser mayor a 0');
  const memberIds = await joinedMemberIds(db, tripId);
  if (!memberIds.includes(input.paidByMemberId)) {
    throw new TripValidationError('El pagador no pertenece al viaje');
  }

  const allocations = buildTripAllocations(input, memberIds);

  const expense = await db.tripExpense.create({
    data: {
      tripId,
      paidByMemberId: input.paidByMemberId,
      amount: input.amount,
      category: input.category,
      note: input.note?.trim() || null,
      date: input.date,
      currency: input.currency ?? 'ARS',
      splitMode: input.splitMode ?? 'EQUAL',
      allocations: { create: allocations },
    },
    include: expenseInclude,
  });

  // Bump to ACTIVE if still planning
  if (me.trip.status === 'PLANNING') {
    await db.trip.update({ where: { id: tripId }, data: { status: 'ACTIVE' } });
  }

  return serializeExpense(expense);
}

export async function updateTripExpense(
  db: Db,
  tripId: string,
  expenseId: string,
  userId: string,
  input: Partial<TripExpenseInput>,
) {
  const me = await requireTripMember(db, tripId, userId);
  assertTripWritable(me.trip.status);

  const existing = await db.tripExpense.findFirst({ where: { id: expenseId, tripId } });
  if (!existing) throw new TripNotFoundError('Gasto no encontrado');

  const memberIds = await joinedMemberIds(db, tripId);
  const merged: TripExpenseInput = {
    amount: input.amount ?? toNum(existing.amount),
    category: input.category ?? existing.category,
    paidByMemberId: input.paidByMemberId ?? existing.paidByMemberId,
    note: input.note !== undefined ? input.note : existing.note,
    date: input.date ?? existing.date,
    currency: input.currency ?? existing.currency,
    splitMode: input.splitMode ?? (existing.splitMode as SplitMode),
    assignToMemberId: input.assignToMemberId,
    splitValues: input.splitValues,
    participantMemberIds: input.participantMemberIds,
  };

  if (!(merged.amount > 0)) throw new TripValidationError('El monto debe ser mayor a 0');
  if (!memberIds.includes(merged.paidByMemberId)) {
    throw new TripValidationError('El pagador no pertenece al viaje');
  }

  const allocations = buildTripAllocations(merged, memberIds);

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
      allocations: { create: allocations },
    },
    include: expenseInclude,
  });
  return serializeExpense(expense);
}

export async function deleteTripExpense(db: Db, tripId: string, expenseId: string, userId: string) {
  const me = await requireTripMember(db, tripId, userId);
  assertTripWritable(me.trip.status);
  const existing = await db.tripExpense.findFirst({ where: { id: expenseId, tripId } });
  if (!existing) throw new TripNotFoundError('Gasto no encontrado');
  await db.tripExpense.delete({ where: { id: expenseId } });
}

export interface TripBalanceMember {
  memberId: string;
  displayName: string;
  userId: string | null;
  paid: number;
  share: number;
  balance: number;
}

export interface TripBalanceTransfer {
  fromMemberId: string;
  fromName: string;
  toMemberId: string;
  toName: string;
  amount: number;
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
  transfers: TripBalanceTransfer[];
  settlements: TripSettlementRow[];
}

export async function computeTripBalance(db: Db, tripId: string): Promise<TripBalanceResult> {
  const [members, expenses, settlementRows] = await Promise.all([
    db.tripMember.findMany({
      where: { tripId, inviteStatus: 'JOINED' },
      select: memberSelect,
    }),
    db.tripExpense.findMany({
      where: { tripId },
      include: { allocations: true },
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

  const names = new Map(members.map((m) => [m.id, m.displayName]));
  const userIds = new Map(members.map((m) => [m.id, m.userId]));
  const paidBy = new Map<string, number>();
  const shareBy = new Map<string, number>();

  for (const m of members) {
    paidBy.set(m.id, 0);
    shareBy.set(m.id, 0);
  }

  for (const expense of expenses) {
    const amount = toNum(expense.amount);
    paidBy.set(expense.paidByMemberId, round2((paidBy.get(expense.paidByMemberId) ?? 0) + amount));
    for (const alloc of expense.allocations) {
      shareBy.set(alloc.tripMemberId, round2((shareBy.get(alloc.tripMemberId) ?? 0) + toNum(alloc.amount)));
    }
  }

  const expensePerMember = members.map((m) => {
    const paid = round2(paidBy.get(m.id) ?? 0);
    const share = round2(shareBy.get(m.id) ?? 0);
    return {
      memberId: m.id,
      displayName: m.displayName,
      userId: m.userId,
      paid,
      share,
      balance: round2(paid - share),
    };
  });

  const offsets = settlementRows.map((s) => ({
    fromUserId: s.fromMemberId,
    toUserId: s.toMemberId,
    amount: toNum(s.amount),
  }));

  const adjusted = applySettlementOffsets(
    expensePerMember.map((u) => ({ userId: u.memberId, balance: u.balance })),
    offsets,
  );
  const balanceBy = new Map(adjusted.map((b) => [b.userId, b.balance]));

  const perMember = expensePerMember
    .map((u) => ({
      ...u,
      balance: round2(balanceBy.get(u.memberId) ?? u.balance),
    }))
    .sort((a, b) => b.balance - a.balance);

  const transfers = computeSettleTransfers(
    perMember.map((u) => ({ userId: u.memberId, balance: u.balance })),
  ).map((t) => ({
    fromMemberId: t.fromUserId,
    fromName: names.get(t.fromUserId) ?? '',
    toMemberId: t.toUserId,
    toName: names.get(t.toUserId) ?? '',
    amount: t.amount,
  }));

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

  // Keep userIds map referenced for type safety / future export
  void userIds;

  return { perMember, transfers, settlements };
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
  userId: string,
  opts?: { note?: string | null; close?: boolean },
) {
  await requireTripMember(db, tripId, userId);
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

export async function listTripListItems(
  db: Db,
  tripId: string,
  userId: string,
  type?: TripListItemType,
) {
  await requireTripMember(db, tripId, userId);
  return db.tripListItem.findMany({
    where: { tripId, ...(type ? { type } : {}) },
    include: {
      assigneeMember: { select: memberSelect },
    },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
  });
}

export async function createTripListItem(
  db: Db,
  tripId: string,
  userId: string,
  input: {
    type: TripListItemType;
    title: string;
    notes?: string | null;
    quantity?: number | null;
    assigneeMemberId?: string | null;
    dayDate?: Date | null;
  },
) {
  const me = await requireTripMember(db, tripId, userId);
  assertTripWritable(me.trip.status);
  const title = input.title.trim();
  if (!title) throw new TripValidationError('El título es obligatorio');

  return db.tripListItem.create({
    data: {
      tripId,
      type: input.type,
      title,
      notes: input.notes?.trim() || null,
      quantity: input.quantity ?? null,
      assigneeMemberId: input.assigneeMemberId ?? null,
      dayDate: input.dayDate ?? null,
    },
    include: { assigneeMember: { select: memberSelect } },
  });
}

export async function updateTripListItem(
  db: Db,
  tripId: string,
  itemId: string,
  userId: string,
  input: {
    title?: string;
    notes?: string | null;
    quantity?: number | null;
    assigneeMemberId?: string | null;
    status?: 'PENDING' | 'DONE';
    dayDate?: Date | null;
    type?: TripListItemType;
  },
) {
  const me = await requireTripMember(db, tripId, userId);
  assertTripWritable(me.trip.status);
  const existing = await db.tripListItem.findFirst({ where: { id: itemId, tripId } });
  if (!existing) throw new TripNotFoundError('Ítem no encontrado');

  return db.tripListItem.update({
    where: { id: itemId },
    data: {
      ...(input.title != null ? { title: input.title.trim() } : {}),
      ...(input.notes !== undefined ? { notes: input.notes?.trim() || null } : {}),
      ...(input.quantity !== undefined ? { quantity: input.quantity } : {}),
      ...(input.assigneeMemberId !== undefined ? { assigneeMemberId: input.assigneeMemberId } : {}),
      ...(input.status != null ? { status: input.status } : {}),
      ...(input.dayDate !== undefined ? { dayDate: input.dayDate } : {}),
      ...(input.type != null ? { type: input.type } : {}),
    },
    include: { assigneeMember: { select: memberSelect } },
  });
}

export async function deleteTripListItem(db: Db, tripId: string, itemId: string, userId: string) {
  const me = await requireTripMember(db, tripId, userId);
  assertTripWritable(me.trip.status);
  const existing = await db.tripListItem.findFirst({ where: { id: itemId, tripId } });
  if (!existing) throw new TripNotFoundError('Ítem no encontrado');
  await db.tripListItem.delete({ where: { id: itemId } });
}

// --- Accommodation ---

export async function upsertTripAccommodation(
  db: Db,
  tripId: string,
  userId: string,
  input: {
    label?: string | null;
    address?: string | null;
    checkIn?: Date | null;
    checkOut?: Date | null;
    link?: string | null;
    notes?: string | null;
  },
) {
  const me = await requireTripMember(db, tripId, userId);
  assertTripWritable(me.trip.status);

  const data = {
    label: input.label?.trim() || null,
    address: input.address?.trim() || null,
    checkIn: input.checkIn ?? null,
    checkOut: input.checkOut ?? null,
    link: input.link?.trim() || null,
    notes: input.notes?.trim() || null,
  };

  return db.tripAccommodation.upsert({
    where: { tripId },
    create: { tripId, ...data },
    update: data,
  });
}

export async function getTripAccommodation(db: Db, tripId: string, userId: string) {
  await requireTripMember(db, tripId, userId);
  return db.tripAccommodation.findUnique({ where: { tripId } });
}
