import type {
  Prisma,
  PrismaClient,
  TripArrivalKind,
  TripItineraryItemType,
  TripMealSlot,
} from '@prisma/client';
import {
  calendarDateToUtc,
  serializeCalendarDate,
  tripTimeZone,
  ymdInTimeZone,
} from '../lib/calendar-date.js';
import {
  assertTripWritable,
  buildTripAllocations,
  defaultTripPayerId,
  normalizeExpensePayments,
  requireTripMember,
  rosterMemberIds,
  scalePaymentsToAmount,
  TripValidationError,
  tripAmountToNum,
  tripRound2,
  type TripActor,
  type TripCalendarDate,
} from './trip.js';

type Db = PrismaClient | Prisma.TransactionClient;

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

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

const itineraryInclude = {
  inChargeMember: { select: memberSelect },
  mealItem: {
    select: {
      id: true,
      type: true,
      mealSlot: true,
      dayDate: true,
      title: true,
      menu: true,
    },
  },
} as const;

export type ItineraryCreateInput = {
  type: 'MEAL' | 'RESERVATION' | 'ACTIVITY';
  dayDate: TripCalendarDate;
  startTime?: string | null;
  endTime?: string | null;
  title?: string | null;
  notes?: string | null;
  sortOrder?: number;
  mealSlot?: TripMealSlot | null;
  menu?: string | null;
  inChargeMemberId?: string | null;
  placeName?: string | null;
  address?: string | null;
  link?: string | null;
  mealItemId?: string | null;
  amount?: number | null;
};

export type ItineraryUpdateInput = {
  dayDate?: TripCalendarDate;
  startTime?: string | null;
  endTime?: string | null;
  title?: string | null;
  notes?: string | null;
  sortOrder?: number;
  mealSlot?: TripMealSlot | null;
  menu?: string | null;
  inChargeMemberId?: string | null;
  placeName?: string | null;
  address?: string | null;
  link?: string | null;
  mealItemId?: string | null;
  amount?: number | null;
};

function encodeDayDate(ymd: TripCalendarDate, timeZone: string): Date {
  try {
    return calendarDateToUtc(ymd, timeZone);
  } catch {
    throw new TripValidationError('Fecha inválida');
  }
}

function normalizeTime(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const t = value.trim();
  if (!TIME_RE.test(t)) throw new TripValidationError('Horario inválido (HH:mm)');
  return t;
}

function isVirtualArrivalId(itemId: string): boolean {
  return itemId.startsWith('arrival:');
}

export function virtualArrivalId(kind: 'CHECK_IN' | 'CHECK_OUT', accommodationId: string): string {
  return `arrival:${kind.toLowerCase()}:${accommodationId}`;
}

function typeRank(type: TripItineraryItemType): number {
  switch (type) {
    case 'ARRIVAL':
      return 0;
    case 'MEAL':
      return 1;
    case 'ACTIVITY':
      return 2;
    case 'RESERVATION':
      return 3;
    default:
      return 9;
  }
}

function sortItineraryItems<
  T extends { startTime: string | null; sortOrder: number; type: TripItineraryItemType },
>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const ta = a.startTime ?? '99:99';
    const tb = b.startTime ?? '99:99';
    if (ta !== tb) return ta.localeCompare(tb);
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return typeRank(a.type) - typeRank(b.type);
  });
}

function serializeMember(
  m: {
    id: string;
    tripId: string;
    userId: string | null;
    displayName: string;
    role: string;
    inviteStatus: string;
    tripHouseholdId: string | null;
    createdAt: Date;
  } | null,
) {
  if (!m) return null;
  return {
    id: m.id,
    tripId: m.tripId,
    userId: m.userId,
    displayName: m.displayName,
    role: m.role,
    inviteStatus: m.inviteStatus,
    tripHouseholdId: m.tripHouseholdId,
    createdAt: m.createdAt.toISOString(),
  };
}

type SerializedItineraryItem = {
  id: string;
  tripId: string;
  type: TripItineraryItemType;
  dayDate: string;
  startTime: string | null;
  endTime: string | null;
  title: string | null;
  notes: string | null;
  sortOrder: number;
  mealSlot: TripMealSlot | null;
  menu: string | null;
  inChargeMemberId: string | null;
  inChargeMember: ReturnType<typeof serializeMember>;
  placeName: string | null;
  address: string | null;
  link: string | null;
  mealItemId: string | null;
  mealItem: {
    id: string;
    type: TripItineraryItemType;
    mealSlot: TripMealSlot | null;
    dayDate: string;
    title: string | null;
    menu: string | null;
  } | null;
  amount: number | null;
  expenseId: string | null;
  arrivalKind: TripArrivalKind | null;
  virtual: boolean;
  createdAt: string;
  updatedAt: string;
};

function serializeItineraryItem(
  row: {
    id: string;
    tripId: string;
    type: TripItineraryItemType;
    dayDate: Date;
    startTime: string | null;
    endTime: string | null;
    title: string | null;
    notes: string | null;
    sortOrder: number;
    mealSlot: TripMealSlot | null;
    menu: string | null;
    inChargeMemberId: string | null;
    inChargeMember?: Parameters<typeof serializeMember>[0];
    placeName: string | null;
    address: string | null;
    link: string | null;
    mealItemId: string | null;
    mealItem?: {
      id: string;
      type: TripItineraryItemType;
      mealSlot: TripMealSlot | null;
      dayDate: Date;
      title: string | null;
      menu: string | null;
    } | null;
    amount: unknown;
    expenseId: string | null;
    arrivalKind: TripArrivalKind | null;
    createdAt: Date;
    updatedAt: Date;
    virtual?: boolean;
  },
  destinationTimezone: string | null,
): SerializedItineraryItem {
  return {
    id: row.id,
    tripId: row.tripId,
    type: row.type,
    dayDate: serializeCalendarDate(row.dayDate, destinationTimezone)!,
    startTime: row.startTime,
    endTime: row.endTime,
    title: row.title,
    notes: row.notes,
    sortOrder: row.sortOrder,
    mealSlot: row.mealSlot,
    menu: row.menu,
    inChargeMemberId: row.inChargeMemberId,
    inChargeMember: serializeMember(row.inChargeMember ?? null),
    placeName: row.placeName,
    address: row.address,
    link: row.link,
    mealItemId: row.mealItemId,
    mealItem: row.mealItem
      ? {
          id: row.mealItem.id,
          type: row.mealItem.type,
          mealSlot: row.mealItem.mealSlot,
          dayDate: serializeCalendarDate(row.mealItem.dayDate, destinationTimezone)!,
          title: row.mealItem.title,
          menu: row.mealItem.menu,
        }
      : null,
    amount: row.amount == null ? null : tripAmountToNum(row.amount),
    expenseId: row.expenseId,
    arrivalKind: row.arrivalKind,
    virtual: row.virtual === true,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function syncActivityItineraryExpense(
  db: Db,
  tripId: string,
  item: {
    id: string;
    expenseId: string | null;
    amount: unknown;
    title: string | null;
    dayDate: Date;
  },
  tripCurrency: string,
  destinationTimezone: string | null,
) {
  const cost = item.amount == null ? null : tripRound2(tripAmountToNum(item.amount));
  const note = item.title?.trim() || 'Actividad';
  const tripMeta = await db.trip.findUniqueOrThrow({
    where: { id: tripId },
    select: { destinationTimezone: true, status: true, baseCurrency: true },
  });
  const tz = tripTimeZone(destinationTimezone ?? tripMeta.destinationTimezone);
  const dateYmd = ymdInTimeZone(item.dayDate, tz);
  const dateUtc = calendarDateToUtc(dateYmd, tz);
  const currency = tripCurrency || tripMeta.baseCurrency;

  if (cost == null || cost <= 0) {
    if (item.expenseId) {
      const linked = await db.tripExpense.findFirst({ where: { id: item.expenseId, tripId } });
      if (linked && !linked.exportedPurchaseId) {
        await db.tripExpense.delete({ where: { id: linked.id } });
      } else if (linked?.exportedPurchaseId) {
        await db.tripItineraryItem.update({
          where: { id: item.id },
          data: { expenseId: null, amount: null },
        });
        return db.tripItineraryItem.findUniqueOrThrow({
          where: { id: item.id },
          include: itineraryInclude,
        });
      }
    }
    return db.tripItineraryItem.update({
      where: { id: item.id },
      data: { expenseId: null, amount: null },
      include: itineraryInclude,
    });
  }

  const memberIds = await rosterMemberIds(db, tripId);
  const payerId = await defaultTripPayerId(db, tripId);
  const equalAllocations = buildTripAllocations(
    {
      amount: cost,
      category: 'ACTIVIDADES',
      paidByMemberId: payerId,
      date: dateYmd,
      splitMode: 'EQUAL',
      participantMemberIds: memberIds,
    },
    memberIds,
  );

  if (item.expenseId) {
    const existing = await db.tripExpense.findFirst({
      where: { id: item.expenseId, tripId },
      include: { payments: true },
    });
    if (!existing) {
      await db.tripItineraryItem.update({ where: { id: item.id }, data: { expenseId: null } });
    } else {
      const scaled = scalePaymentsToAmount(
        existing.payments.map((p) => ({
          memberId: p.tripMemberId,
          amount: tripAmountToNum(p.amount),
        })),
        cost,
        existing.paidByMemberId,
      );
      const { payments, paidByMemberId } = normalizeExpensePayments(cost, memberIds, {
        payments: scaled,
      });

      let allocations = equalAllocations;
      if (existing.splitMode !== 'EQUAL') {
        const existingAllocs = await db.tripExpenseAllocation.findMany({
          where: { tripExpenseId: existing.id },
        });
        allocations = scalePaymentsToAmount(
          existingAllocs.map((a) => ({
            memberId: a.tripMemberId,
            amount: tripAmountToNum(a.amount),
          })),
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
          category: 'ACTIVIDADES',
          note,
          date: dateUtc,
          currency: existing.currency || currency,
          payments: {
            create: payments.map((p) => ({ tripMemberId: p.memberId, amount: p.amount })),
          },
          allocations: { create: allocations },
        },
      });
      return db.tripItineraryItem.update({
        where: { id: item.id },
        data: { amount: cost, expenseId: existing.id },
        include: itineraryInclude,
      });
    }
  }

  const expense = await db.tripExpense.create({
    data: {
      tripId,
      paidByMemberId: payerId,
      amount: cost,
      category: 'ACTIVIDADES',
      note,
      date: dateUtc,
      currency,
      splitMode: 'EQUAL',
      payments: { create: [{ tripMemberId: payerId, amount: cost }] },
      allocations: { create: equalAllocations },
    },
  });

  if (tripMeta.status === 'PLANNING') {
    await db.trip.update({ where: { id: tripId }, data: { status: 'ACTIVE' } });
  }

  return db.tripItineraryItem.update({
    where: { id: item.id },
    data: { amount: cost, expenseId: expense.id },
    include: itineraryInclude,
  });
}

function buildVirtualArrivals(
  tripId: string,
  acc: {
    id: string;
    label: string | null;
    address: string | null;
    checkIn: Date | null;
    checkOut: Date | null;
    checkInTime: string | null;
    checkOutTime: string | null;
    createdAt: Date;
    updatedAt: Date;
  } | null,
  destinationTimezone: string | null,
  filterDateUtc: Date | null,
): SerializedItineraryItem[] {
  if (!acc) return [];
  const tz = tripTimeZone(destinationTimezone);
  const items: SerializedItineraryItem[] = [];

  const push = (kind: 'CHECK_IN' | 'CHECK_OUT', day: Date | null, time: string | null) => {
    if (!day) return;
    if (filterDateUtc) {
      const filterYmd = ymdInTimeZone(filterDateUtc, tz);
      const dayYmd = ymdInTimeZone(day, tz);
      if (filterYmd !== dayYmd) return;
    }
    items.push(
      serializeItineraryItem(
        {
          id: virtualArrivalId(kind, acc.id),
          tripId,
          type: 'ARRIVAL',
          dayDate: day,
          startTime: time,
          endTime: null,
          title: kind === 'CHECK_IN' ? 'Check-in' : 'Check-out',
          notes: acc.label || acc.address || null,
          sortOrder: kind === 'CHECK_IN' ? 0 : 1,
          mealSlot: null,
          menu: null,
          inChargeMemberId: null,
          placeName: acc.label,
          address: acc.address,
          link: null,
          mealItemId: null,
          amount: null,
          expenseId: null,
          arrivalKind: kind,
          createdAt: acc.createdAt,
          updatedAt: acc.updatedAt,
          virtual: true,
        },
        destinationTimezone,
      ),
    );
  };

  push('CHECK_IN', acc.checkIn, acc.checkInTime);
  push('CHECK_OUT', acc.checkOut, acc.checkOutTime);
  return items;
}

async function assertMemberOnTrip(db: Db, tripId: string, memberId: string | null | undefined) {
  if (memberId == null) return;
  const m = await db.tripMember.findFirst({ where: { id: memberId, tripId } });
  if (!m) throw new TripValidationError('Viajero no encontrado');
}

async function assertMealLink(
  db: Db,
  tripId: string,
  mealItemId: string | null | undefined,
  dayDateUtc: Date,
  destinationTimezone: string | null,
) {
  if (mealItemId == null) return;
  const meal = await db.tripItineraryItem.findFirst({
    where: { id: mealItemId, tripId, type: 'MEAL' },
  });
  if (!meal) throw new TripValidationError('La comida vinculada no existe');
  const tz = tripTimeZone(destinationTimezone);
  if (ymdInTimeZone(meal.dayDate, tz) !== ymdInTimeZone(dayDateUtc, tz)) {
    throw new TripValidationError('La reserva debe vincularse a una comida del mismo día');
  }
}

async function assertUniqueMealSlot(
  db: Db,
  tripId: string,
  dayDateUtc: Date,
  mealSlot: TripMealSlot,
  excludeId?: string,
) {
  const existing = await db.tripItineraryItem.findFirst({
    where: {
      tripId,
      type: 'MEAL',
      mealSlot,
      dayDate: dayDateUtc,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
  });
  if (existing) {
    throw new TripValidationError('Ya hay una comida de ese tipo ese día');
  }
}

export async function listTripItinerary(
  db: Db,
  tripId: string,
  actor: TripActor | string,
  opts?: { date?: TripCalendarDate | null },
) {
  const me = await requireTripMember(db, tripId, actor);
  const tzName = me.trip.destinationTimezone ?? null;
  const tz = tripTimeZone(tzName);

  let filterDateUtc: Date | null = null;
  const where: Prisma.TripItineraryItemWhereInput = {
    tripId,
    type: { in: ['MEAL', 'RESERVATION', 'ACTIVITY'] },
  };
  if (opts?.date) {
    filterDateUtc = encodeDayDate(opts.date, tz);
    where.dayDate = filterDateUtc;
  }

  const rows = await db.tripItineraryItem.findMany({
    where,
    include: itineraryInclude,
    orderBy: [{ dayDate: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
  });

  const acc = await db.tripAccommodation.findUnique({ where: { tripId } });
  const virtual = buildVirtualArrivals(tripId, acc, tzName, filterDateUtc);
  const persisted = rows.map((r) => serializeItineraryItem({ ...r, virtual: false }, tzName));

  return sortItineraryItems([...virtual, ...persisted]);
}

export async function createTripItineraryItem(
  db: Db,
  tripId: string,
  actor: TripActor | string,
  input: ItineraryCreateInput,
) {
  const me = await requireTripMember(db, tripId, actor);
  assertTripWritable(me.trip.status);
  const tzName = me.trip.destinationTimezone ?? null;
  const tz = tripTimeZone(tzName);
  const dayDateUtc = encodeDayDate(input.dayDate, tz);
  const startTime = normalizeTime(input.startTime) ?? null;
  const endTime = normalizeTime(input.endTime) ?? null;

  if (input.type === 'MEAL') {
    if (!input.mealSlot) throw new TripValidationError('Indicá desayuno, almuerzo o cena');
    await assertUniqueMealSlot(db, tripId, dayDateUtc, input.mealSlot);
    await assertMemberOnTrip(db, tripId, input.inChargeMemberId);
    const row = await db.tripItineraryItem.create({
      data: {
        tripId,
        type: 'MEAL',
        dayDate: dayDateUtc,
        startTime,
        endTime,
        title: input.title?.trim() || null,
        notes: input.notes?.trim() || null,
        sortOrder: input.sortOrder ?? 0,
        mealSlot: input.mealSlot,
        menu: input.menu?.trim() || null,
        inChargeMemberId: input.inChargeMemberId ?? null,
      },
      include: itineraryInclude,
    });
    return serializeItineraryItem(row, tzName);
  }

  if (input.type === 'RESERVATION') {
    const placeName = input.placeName?.trim() || input.title?.trim() || '';
    if (!placeName) throw new TripValidationError('Indicá el restaurante o lugar');
    await assertMealLink(db, tripId, input.mealItemId, dayDateUtc, tzName);
    const row = await db.tripItineraryItem.create({
      data: {
        tripId,
        type: 'RESERVATION',
        dayDate: dayDateUtc,
        startTime,
        endTime,
        title: input.title?.trim() || placeName,
        notes: input.notes?.trim() || null,
        sortOrder: input.sortOrder ?? 0,
        placeName,
        address: input.address?.trim() || null,
        link: input.link?.trim() || null,
        mealItemId: input.mealItemId ?? null,
      },
      include: itineraryInclude,
    });
    return serializeItineraryItem(row, tzName);
  }

  const title = input.title?.trim() || '';
  if (!title) throw new TripValidationError('Indicá la actividad');
  if (input.amount != null && !(input.amount >= 0)) {
    throw new TripValidationError('El costo debe ser mayor o igual a 0');
  }
  let row = await db.tripItineraryItem.create({
    data: {
      tripId,
      type: 'ACTIVITY',
      dayDate: dayDateUtc,
      startTime,
      endTime,
      title,
      notes: input.notes?.trim() || null,
      sortOrder: input.sortOrder ?? 0,
      amount: input.amount ?? null,
      placeName: input.placeName?.trim() || null,
      address: input.address?.trim() || null,
      link: input.link?.trim() || null,
    },
    include: itineraryInclude,
  });
  row = await syncActivityItineraryExpense(db, tripId, row, me.trip.baseCurrency, tzName);
  return serializeItineraryItem(row, tzName);
}

export async function updateTripItineraryItem(
  db: Db,
  tripId: string,
  itemId: string,
  actor: TripActor | string,
  input: ItineraryUpdateInput,
) {
  if (isVirtualArrivalId(itemId)) {
    throw new TripValidationError('El check-in/check-out se edita desde Alojamiento');
  }

  const me = await requireTripMember(db, tripId, actor);
  assertTripWritable(me.trip.status);
  const tzName = me.trip.destinationTimezone ?? null;
  const tz = tripTimeZone(tzName);

  const existing = await db.tripItineraryItem.findFirst({
    where: { id: itemId, tripId },
    include: itineraryInclude,
  });
  if (!existing) throw new TripValidationError('Ítem no encontrado');
  if (existing.type === 'ARRIVAL') {
    throw new TripValidationError('Este ítem no se puede editar todavía');
  }

  const dayDateUtc =
    input.dayDate !== undefined ? encodeDayDate(input.dayDate, tz) : existing.dayDate;

  const data: Prisma.TripItineraryItemUpdateInput = {};

  if (input.dayDate !== undefined) data.dayDate = dayDateUtc;
  if (input.startTime !== undefined) data.startTime = normalizeTime(input.startTime) ?? null;
  if (input.endTime !== undefined) data.endTime = normalizeTime(input.endTime) ?? null;
  if (input.title !== undefined) data.title = input.title?.trim() || null;
  if (input.notes !== undefined) data.notes = input.notes?.trim() || null;
  if (input.sortOrder !== undefined) data.sortOrder = input.sortOrder;

  if (existing.type === 'MEAL') {
    const mealSlot = input.mealSlot !== undefined ? input.mealSlot : existing.mealSlot;
    if (!mealSlot) throw new TripValidationError('Indicá desayuno, almuerzo o cena');
    if (
      mealSlot !== existing.mealSlot ||
      ymdInTimeZone(dayDateUtc, tz) !== ymdInTimeZone(existing.dayDate, tz)
    ) {
      await assertUniqueMealSlot(db, tripId, dayDateUtc, mealSlot, existing.id);
    }
    if (input.mealSlot !== undefined) data.mealSlot = mealSlot;
    if (input.menu !== undefined) data.menu = input.menu?.trim() || null;
    if (input.inChargeMemberId !== undefined) {
      await assertMemberOnTrip(db, tripId, input.inChargeMemberId);
      data.inChargeMember =
        input.inChargeMemberId == null
          ? { disconnect: true }
          : { connect: { id: input.inChargeMemberId } };
    }
  }

  if (existing.type === 'RESERVATION') {
    if (input.placeName !== undefined || input.title !== undefined) {
      const placeName =
        (input.placeName !== undefined ? input.placeName?.trim() : existing.placeName) ||
        (input.title !== undefined ? input.title?.trim() : existing.title) ||
        '';
      if (!placeName) throw new TripValidationError('Indicá el restaurante o lugar');
      data.placeName = placeName;
      if (input.title !== undefined) data.title = input.title?.trim() || placeName;
    }
    if (input.address !== undefined) data.address = input.address?.trim() || null;
    if (input.link !== undefined) data.link = input.link?.trim() || null;
    if (input.mealItemId !== undefined) {
      await assertMealLink(db, tripId, input.mealItemId, dayDateUtc, tzName);
      data.mealItem =
        input.mealItemId == null
          ? { disconnect: true }
          : { connect: { id: input.mealItemId } };
    } else if (input.dayDate !== undefined && existing.mealItemId) {
      await assertMealLink(db, tripId, existing.mealItemId, dayDateUtc, tzName);
    }
  }

  if (existing.type === 'ACTIVITY') {
    if (input.title !== undefined) {
      const title = input.title?.trim() || '';
      if (!title) throw new TripValidationError('Indicá la actividad');
      data.title = title;
    }
    if (input.placeName !== undefined) data.placeName = input.placeName?.trim() || null;
    if (input.address !== undefined) data.address = input.address?.trim() || null;
    if (input.link !== undefined) data.link = input.link?.trim() || null;
    if (input.amount !== undefined) {
      if (input.amount != null && !(input.amount >= 0)) {
        throw new TripValidationError('El costo debe ser mayor o igual a 0');
      }
      data.amount = input.amount;
    }
  }

  let row = await db.tripItineraryItem.update({
    where: { id: existing.id },
    data,
    include: itineraryInclude,
  });

  if (
    existing.type === 'ACTIVITY' &&
    (input.amount !== undefined || input.title !== undefined || input.dayDate !== undefined)
  ) {
    row = await syncActivityItineraryExpense(db, tripId, row, me.trip.baseCurrency, tzName);
  }

  return serializeItineraryItem(row, tzName);
}

export async function deleteTripItineraryItem(
  db: Db,
  tripId: string,
  itemId: string,
  actor: TripActor | string,
) {
  if (isVirtualArrivalId(itemId)) {
    throw new TripValidationError('El check-in/check-out se edita desde Alojamiento');
  }

  const me = await requireTripMember(db, tripId, actor);
  assertTripWritable(me.trip.status);

  const existing = await db.tripItineraryItem.findFirst({
    where: { id: itemId, tripId },
  });
  if (!existing) throw new TripValidationError('Ítem no encontrado');

  if (existing.type === 'ACTIVITY' && existing.expenseId) {
    const linked = await db.tripExpense.findFirst({
      where: { id: existing.expenseId, tripId },
    });
    if (linked && !linked.exportedPurchaseId) {
      await db.tripItineraryItem.update({
        where: { id: existing.id },
        data: { expenseId: null },
      });
      await db.tripExpense.delete({ where: { id: linked.id } });
    } else {
      await db.tripItineraryItem.update({
        where: { id: existing.id },
        data: { expenseId: null },
      });
    }
  }

  if (existing.type === 'MEAL') {
    await db.tripItineraryItem.updateMany({
      where: { mealItemId: existing.id },
      data: { mealItemId: null },
    });
  }

  await db.tripItineraryItem.delete({ where: { id: existing.id } });
}
