import type { TripExpenseCategory } from '@biko/shared';
import type { Prisma, PrismaClient } from '@prisma/client';
import { createPurchaseWithAllocations, ExpenseValidationError } from './expense-purchase.js';
import { ensureDefaultPaymentMethods } from './household-defaults.js';
import { requireTripOrganizer, TripForbiddenError, TripValidationError } from './trip.js';
import {
  planTripHouseholdExport,
  type TripExportCategoryMix,
  type TripExportPurchaseSpec,
  type TripHouseholdExportPlan,
} from './trip-export-plan.js';

type Db = PrismaClient | Prisma.TransactionClient;

function toNum(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === 'object' && value !== null && 'toNumber' in value) {
    return (value as { toNumber(): number }).toNumber();
  }
  return Number(value);
}

export interface TripExportPreview {
  eligible: boolean;
  reason?: string;
  tripId: string;
  householdId: string;
  netShare: number;
  alreadyExported: boolean;
  categoryMix: TripExportCategoryMix[];
}

function emptyPreview(
  tripId: string,
  householdId: string,
  extra: Partial<TripExportPreview>,
): TripExportPreview {
  return {
    eligible: false,
    tripId,
    householdId,
    netShare: 0,
    alreadyExported: false,
    categoryMix: [],
    ...extra,
  };
}

async function loadExportPlan(
  db: Db,
  tripId: string,
  householdId: string,
  exporterUserId: string,
): Promise<TripHouseholdExportPlan> {
  const householdUsers = await db.user.findMany({
    where: { householdId },
    select: { id: true, name: true },
    orderBy: { id: 'asc' },
  });
  const householdUserIds = householdUsers.map((u) => u.id);
  const householdUserNames = new Map(householdUsers.map((u) => [u.id, u.name]));

  const tripMembers = await db.tripMember.findMany({
    where: {
      tripId,
      inviteStatus: 'JOINED',
      userId: { in: householdUserIds },
    },
    select: { id: true, userId: true },
  });
  const tripMemberToUserId = new Map(
    tripMembers
      .filter((m): m is { id: string; userId: string } => Boolean(m.userId))
      .map((m) => [m.id, m.userId]),
  );

  const expenses = await db.tripExpense.findMany({
    where: { tripId },
    select: {
      category: true,
      payments: { select: { tripMemberId: true, amount: true } },
      allocations: { select: { tripMemberId: true, amount: true } },
    },
  });

  return planTripHouseholdExport({
    expenses: expenses.map((e) => ({
      category: e.category as TripExpenseCategory,
      payments: e.payments.map((p) => ({
        tripMemberId: p.tripMemberId,
        amount: toNum(p.amount),
      })),
      allocations: e.allocations.map((a) => ({
        tripMemberId: a.tripMemberId,
        amount: toNum(a.amount),
      })),
    })),
    tripMemberToUserId,
    householdUserIds,
    householdUserNames,
    exporterUserId,
  });
}

async function resolveCashPaymentMethodId(db: Db, householdId: string): Promise<string | null> {
  const findCash = () =>
    db.paymentMethod.findFirst({
      where: {
        householdId,
        ownerUserId: null,
        definition: { type: 'CASH' },
      },
      select: { id: true },
    });

  const existing = await findCash();
  if (existing) return existing.id;

  await ensureDefaultPaymentMethods(db, householdId);
  const created = await findCash();
  return created?.id ?? null;
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
    return emptyPreview(tripId, householdId, {
      reason: 'Solo el organizador puede pasar el viaje a Biko',
    });
  }

  const trip = organizer.trip;
  const existing = await db.tripExportBatch.findUnique({
    where: { tripId_householdId: { tripId, householdId } },
  });
  if (existing || trip.exportHouseholdId === householdId) {
    return emptyPreview(tripId, householdId, {
      reason: 'Este viaje ya fue pasado a Biko',
      alreadyExported: true,
    });
  }

  if (trip.status !== 'CLOSED') {
    return emptyPreview(tripId, householdId, {
      reason: 'Liquidá el viaje antes de pasarlo a Biko',
    });
  }

  const plan = await loadExportPlan(db, tripId, householdId, userId);
  if (plan.netShare <= 0) {
    return emptyPreview(tripId, householdId, {
      reason: 'No hay parte del hogar para exportar',
    });
  }

  return {
    eligible: true,
    tripId,
    householdId,
    netShare: plan.netShare,
    alreadyExported: false,
    categoryMix: plan.categoryMix,
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
  const paymentMethodId = await resolveCashPaymentMethodId(prisma, householdId);
  if (!paymentMethodId) {
    throw new TripValidationError('No hay medio de pago en el hogar para registrar el gasto');
  }

  const plan = await loadExportPlan(prisma, tripId, householdId, userId);
  const seedNames = [...new Set(plan.purchases.map((p) => p.seedCategoryName))];
  const categories = await prisma.category.findMany({
    where: { householdId: null, name: { in: seedNames } },
  });
  const categoryByName = new Map(categories.map((c) => [c.name, c.id]));
  for (const name of seedNames) {
    if (!categoryByName.has(name)) {
      throw new TripValidationError(`Falta la categoría global "${name}". Corré el seed.`);
    }
  }

  const purchaseDate = trip.endDate ?? trip.startDate ?? new Date();
  const storeLabel = trip.destination
    ? `Viaje: ${trip.name} (${trip.destination})`
    : `Viaje: ${trip.name}`;

  await prisma
    .$transaction(async (tx) => {
      const purchaseIds: string[] = [];
      for (const spec of plan.purchases) {
        if (spec.amount <= 0) continue;
        const categoryId = categoryByName.get(spec.seedCategoryName)!;
        const clientId = purchaseClientId(tripId, householdId, spec);

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
            paymentMethodId,
            categoryId,
            store: storeLabel,
            description: purchaseDescription(spec),
            purchaseDate,
            grossAmount: spec.amount,
            installmentsCount: 1,
            promotionMode: 'off',
            scope: 'HOUSEHOLD',
            splitMode: 'AMOUNT',
            splitValues: spec.splitValues,
            currency: 'ARS',
            paidByUserId: spec.paidByUserId,
          },
          clientId,
        );
        purchaseIds.push(purchase.id);
      }

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
    })
    .catch((error) => {
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

function purchaseClientId(
  tripId: string,
  householdId: string,
  spec: TripExportPurchaseSpec,
): string {
  return `trip-export:${tripId}:${householdId}:${spec.category}:${spec.paidByUserId}:${spec.index}`;
}

function purchaseDescription(spec: TripExportPurchaseSpec): string {
  if (spec.coveredByOthers) {
    return `Pasar a Biko · ${spec.seedCategoryName} (lo pagó el grupo)`;
  }
  return `Pasar a Biko · ${spec.seedCategoryName}`;
}
