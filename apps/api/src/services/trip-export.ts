import { tripCategorySeedName, type TripExpenseCategory } from '@biko/shared';
import type { Prisma, PrismaClient } from '@prisma/client';
import { createPurchaseWithAllocations, ExpenseValidationError } from './expense-purchase.js';
import {
  computeCategoryTotals,
  requireTripOrganizer,
  TripForbiddenError,
  TripValidationError,
} from './trip.js';

type Db = PrismaClient | Prisma.TransactionClient;

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export interface TripExportPreview {
  eligible: boolean;
  reason?: string;
  tripId: string;
  householdId: string;
  netShare: number;
  alreadyExported: boolean;
  categoryMix: Array<{
    category: TripExpenseCategory;
    seedCategoryName: string;
    percent: number;
    amount: number;
  }>;
}

/**
 * Net trip share for the exporter's household members on the trip
 * = sum of allocation shares for trip members who belong to this household.
 */
async function computeHouseholdNetShare(
  db: Db,
  tripId: string,
  householdId: string,
): Promise<{ netShare: number; householdMemberIdsOnTrip: string[]; householdUserIds: string[] }> {
  const householdUsers = await db.user.findMany({
    where: { householdId },
    select: { id: true },
  });
  const householdUserIds = householdUsers.map((u) => u.id);

  const tripMembers = await db.tripMember.findMany({
    where: {
      tripId,
      inviteStatus: 'JOINED',
      userId: { in: householdUserIds },
    },
    select: { id: true, userId: true },
  });

  const householdMemberIdsOnTrip = tripMembers.map((m) => m.id);
  if (householdMemberIdsOnTrip.length === 0) {
    return { netShare: 0, householdMemberIdsOnTrip, householdUserIds };
  }

  const allocations = await db.tripExpenseAllocation.findMany({
    where: {
      tripMemberId: { in: householdMemberIdsOnTrip },
      tripExpense: { tripId },
    },
    select: { amount: true },
  });

  const netShare = round2(
    allocations.reduce((s, a) => {
      const n =
        typeof a.amount === 'object' && a.amount !== null && 'toNumber' in a.amount
          ? (a.amount as { toNumber(): number }).toNumber()
          : Number(a.amount);
      return s + n;
    }, 0),
  );

  return { netShare, householdMemberIdsOnTrip, householdUserIds };
}

export async function previewTripExport(
  db: Db,
  tripId: string,
  userId: string,
  householdId: string,
): Promise<TripExportPreview> {
  let organizer;
  try {
    organizer = await requireTripOrganizer(db, tripId, userId);
  } catch {
    return {
      eligible: false,
      reason: 'Solo el organizador puede pasar el viaje a Biko',
      tripId,
      householdId,
      netShare: 0,
      alreadyExported: false,
      categoryMix: [],
    };
  }

  const trip = organizer.trip;
  const existing = await db.tripExportBatch.findUnique({
    where: { tripId_householdId: { tripId, householdId } },
  });
  if (existing || trip.exportHouseholdId === householdId) {
    return {
      eligible: false,
      reason: 'Este viaje ya fue pasado a Biko',
      tripId,
      householdId,
      netShare: 0,
      alreadyExported: true,
      categoryMix: [],
    };
  }

  if (trip.status !== 'CLOSED') {
    return {
      eligible: false,
      reason: 'Liquidá el viaje antes de pasarlo a Biko',
      tripId,
      householdId,
      netShare: 0,
      alreadyExported: false,
      categoryMix: [],
    };
  }

  const { netShare } = await computeHouseholdNetShare(db, tripId, householdId);
  if (netShare <= 0) {
    return {
      eligible: false,
      reason: 'No hay parte del hogar para exportar',
      tripId,
      householdId,
      netShare: 0,
      alreadyExported: false,
      categoryMix: [],
    };
  }

  const totals = await computeCategoryTotals(db, tripId);
  const categoryMix = totals.map((t) => ({
    category: t.category as TripExpenseCategory,
    seedCategoryName: tripCategorySeedName(t.category as TripExpenseCategory),
    percent: t.percent,
    amount: round2((netShare * t.percent) / 100),
  }));

  // Fix rounding drift on last bucket
  if (categoryMix.length > 0) {
    const sum = round2(categoryMix.reduce((s, c) => s + c.amount, 0));
    const drift = round2(netShare - sum);
    if (Math.abs(drift) >= 0.01) {
      categoryMix[categoryMix.length - 1]!.amount = round2(
        categoryMix[categoryMix.length - 1]!.amount + drift,
      );
    }
  }

  return {
    eligible: true,
    tripId,
    householdId,
    netShare,
    alreadyExported: false,
    categoryMix: categoryMix.filter((c) => c.amount > 0),
  };
}

export async function exportTripToHousehold(
  prisma: PrismaClient,
  tripId: string,
  userId: string,
  householdId: string,
) {
  const preview = await previewTripExport(prisma, tripId, userId, householdId);
  if (!preview.eligible) {
    if (preview.alreadyExported) {
      const batch = await prisma.tripExportBatch.findUnique({
        where: { tripId_householdId: { tripId, householdId } },
      });
      if (batch) return { batch, purchaseIds: batch.purchaseIds, preview };
      throw new TripValidationError(preview.reason ?? 'No se puede exportar');
    }
    if (preview.reason?.includes('organizador')) {
      throw new TripForbiddenError(preview.reason);
    }
    throw new TripValidationError(preview.reason ?? 'No se puede exportar');
  }

  const trip = await prisma.trip.findUniqueOrThrow({ where: { id: tripId } });
  const paymentMethod = await prisma.paymentMethod.findFirst({
    where: { householdId, OR: [{ ownerUserId: userId }, { ownerUserId: null }] },
    orderBy: { id: 'asc' },
  });
  if (!paymentMethod) {
    throw new TripValidationError('No hay medio de pago en el hogar para registrar el gasto');
  }

  const seedNames = [...new Set(preview.categoryMix.map((c) => c.seedCategoryName))];
  const categories = await prisma.category.findMany({
    where: { householdId: null, name: { in: seedNames } },
  });
  const categoryByName = new Map(categories.map((c) => [c.name, c.id]));
  for (const name of seedNames) {
    if (!categoryByName.has(name)) {
      throw new TripValidationError(`Falta la categoría global "${name}". Corré el seed.`);
    }
  }

  const householdUsers = await prisma.user.findMany({
    where: { householdId },
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  const memberIds = householdUsers.map((u) => u.id);

  const purchaseIds: string[] = [];
  const purchaseDate = trip.endDate ?? trip.startDate ?? new Date();
  const storeLabel = trip.destination
    ? `Viaje: ${trip.name} (${trip.destination})`
    : `Viaje: ${trip.name}`;

  await prisma.$transaction(async (tx) => {
    for (const bucket of preview.categoryMix) {
      if (bucket.amount <= 0) continue;
      const categoryId = categoryByName.get(bucket.seedCategoryName)!;
      const clientId = `trip-export:${tripId}:${householdId}:${bucket.category}`;

      const existing = await tx.purchase.findUnique({ where: { clientId } });
      if (existing) {
        purchaseIds.push(existing.id);
        continue;
      }

      const purchase = await createPurchaseWithAllocations(
        tx as Prisma.TransactionClient,
        householdId,
        userId,
        {
          paymentMethodId: paymentMethod.id,
          categoryId,
          store: storeLabel,
          description: `Pasar a Biko · ${bucket.seedCategoryName}`,
          purchaseDate,
          grossAmount: bucket.amount,
          installmentsCount: 1,
          promotionMode: 'off',
          scope: 'HOUSEHOLD',
          splitMode: 'EQUAL',
          currency: 'ARS',
          paidByUserId: userId,
        },
        clientId,
      );
      purchaseIds.push(purchase.id);
    }

    // Ensure EQUAL allocations across household even if create used them —
    // createPurchaseWithAllocations already splits by household members.
    void memberIds;

    const batch = await tx.tripExportBatch.create({
      data: {
        tripId,
        householdId,
        exportedByUserId: userId,
        purchaseIds,
      },
    });

    await tx.trip.update({
      where: { id: tripId },
      data: {
        exportHouseholdId: householdId,
        exportBatchId: batch.id,
        exportedAt: new Date(),
      },
    });

    return batch;
  }).catch((error) => {
    if (error instanceof ExpenseValidationError) {
      throw new TripValidationError(error.message);
    }
    throw error;
  });

  const batch = await prisma.tripExportBatch.findUniqueOrThrow({
    where: { tripId_householdId: { tripId, householdId } },
  });

  return { batch, purchaseIds: batch.purchaseIds, preview };
}
