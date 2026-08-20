import type { TripExpenseCategory } from '@biko/shared';
import type { Prisma, PrismaClient } from '@prisma/client';
import { createPurchaseWithAllocations, ExpenseValidationError } from './expense-purchase.js';
import { ensureDefaultPaymentMethods } from './household-defaults.js';
import { requireTripOrganizer, TripForbiddenError, TripValidationError } from './trip.js';
import {
  planTripHouseholdExport,
  type TripExportCategoryMix,
  type TripExportPlanMember,
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
  members: TripExportPlanMember[];
  /** Household purchase id when already exported (single Viaje). */
  purchaseId?: string | null;
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
    members: [],
    ...extra,
  };
}

function previewFromPlan(
  tripId: string,
  householdId: string,
  plan: TripHouseholdExportPlan,
  extra: Partial<TripExportPreview> = {},
): TripExportPreview {
  return {
    eligible: false,
    tripId,
    householdId,
    netShare: plan.netShare,
    alreadyExported: false,
    categoryMix: plan.categoryMix,
    members: plan.members,
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

async function findExportedPurchaseId(
  db: Db,
  tripId: string,
  householdId: string,
  batchPurchaseIds: string[],
): Promise<string | null> {
  const bySource = await db.purchase.findFirst({
    where: { householdId, sourceTripId: tripId },
    select: { id: true },
  });
  if (bySource) return bySource.id;
  if (batchPurchaseIds.length === 1) return batchPurchaseIds[0]!;
  return batchPurchaseIds[0] ?? null;
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
    const plan = await loadExportPlan(db, tripId, householdId, userId);
    const purchaseId = existing
      ? await findExportedPurchaseId(db, tripId, householdId, existing.purchaseIds)
      : null;
    return previewFromPlan(tripId, householdId, plan, {
      reason: 'Este viaje ya fue pasado a Biko',
      alreadyExported: true,
      purchaseId,
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

  return previewFromPlan(tripId, householdId, plan, {
    eligible: true,
    alreadyExported: false,
  });
}

export async function exportTripToHousehold(
  prisma: PrismaClient,
  tripId: string,
  userId: string,
  householdId: string,
  opts?: { replace?: boolean },
) {
  const replace = opts?.replace === true;
  const preview = await previewTripExport(prisma, tripId, userId, householdId);

  if (!preview.eligible) {
    if (preview.alreadyExported && !replace) {
      const batch = await prisma.tripExportBatch.findUnique({
        where: { tripId_householdId: { tripId, householdId } },
      });
      if (batch) return { batch, purchaseIds: batch.purchaseIds, preview };
      throw new TripValidationError(preview.reason ?? 'No se puede exportar');
    }
    if (!preview.alreadyExported) {
      if (preview.reason?.includes('organizador')) {
        throw new TripForbiddenError(preview.reason);
      }
      throw new TripValidationError(preview.reason ?? 'No se puede exportar');
    }
  }

  await requireTripOrganizer(prisma, tripId, userId);

  const trip = await prisma.trip.findUniqueOrThrow({ where: { id: tripId } });
  if (trip.status !== 'CLOSED') {
    throw new TripValidationError('Liquidá el viaje antes de pasarlo a Biko');
  }

  const paymentMethodId = await resolveCashPaymentMethodId(prisma, householdId);
  if (!paymentMethodId) {
    throw new TripValidationError('No hay medio de pago en el hogar para registrar el gasto');
  }

  const plan = await loadExportPlan(prisma, tripId, householdId, userId);
  if (plan.netShare <= 0 || plan.purchases.length === 0) {
    throw new TripValidationError('No hay parte del hogar para exportar');
  }

  const spec = plan.purchases[0]!;
  const category = await prisma.category.findFirst({
    where: { householdId: null, name: spec.seedCategoryName },
  });
  if (!category) {
    throw new TripValidationError(`Falta la categoría global "${spec.seedCategoryName}". Corré el seed.`);
  }

  const purchaseDate = trip.endDate ?? trip.startDate ?? new Date();
  const storeLabel = trip.destination
    ? `Viaje: ${trip.name} (${trip.destination})`
    : `Viaje: ${trip.name}`;
  const clientId = purchaseClientId(tripId, householdId);

  const resultPreview = previewFromPlan(tripId, householdId, plan, {
    eligible: false,
    alreadyExported: true,
  });

  try {
    const batch = await prisma.$transaction(
      async (tx) => {
        if (replace) {
          await clearPreviousExport(tx, tripId, householdId);
        }

        const existingByClient = await tx.purchase.findUnique({ where: { clientId } });
        const existingBySource = await tx.purchase.findFirst({
          where: { householdId, sourceTripId: tripId },
        });
        let purchaseId = existingByClient?.id ?? existingBySource?.id ?? null;

        if (!purchaseId) {
          const purchase = await createPurchaseWithAllocations(
            tx as Prisma.TransactionClient,
            householdId,
            userId,
            {
              paymentMethodId,
              categoryId: category.id,
              store: storeLabel,
              description: purchaseDescription(spec),
              purchaseDate,
              grossAmount: spec.amount,
              installmentsCount: 1,
              promotionMode: 'off',
              scope: 'HOUSEHOLD',
              splitMode: 'AMOUNT',
              splitValues: spec.splitValues,
              payments: spec.payments,
              paidByUserId: spec.paidByUserId,
              sourceTripId: tripId,
              skipPartnerNotify: true,
              currency: 'ARS',
            },
            clientId,
          );
          purchaseId = purchase.id;
        }

        const purchaseIds = [purchaseId];
        const batch = await tx.tripExportBatch.upsert({
          where: { tripId_householdId: { tripId, householdId } },
          create: {
            tripId,
            householdId,
            exportedByUserId: userId,
            purchaseIds,
          },
          update: {
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
      },
      { timeout: 20_000 },
    );

    return {
      batch,
      purchaseIds: batch.purchaseIds,
      preview: { ...resultPreview, purchaseId: batch.purchaseIds[0] ?? null },
    };
  } catch (error) {
    throw wrapExportError(error);
  }
}

async function clearPreviousExport(
  tx: Prisma.TransactionClient,
  tripId: string,
  householdId: string,
) {
  const batch = await tx.tripExportBatch.findUnique({
    where: { tripId_householdId: { tripId, householdId } },
  });
  const ids = new Set<string>(batch?.purchaseIds ?? []);
  const linked = await tx.purchase.findMany({
    where: { householdId, sourceTripId: tripId },
    select: { id: true },
  });
  for (const p of linked) ids.add(p.id);

  // Also remove legacy multi-purchase exports by clientId prefix.
  const legacy = await tx.purchase.findMany({
    where: {
      householdId,
      clientId: { startsWith: `trip-export:${tripId}:${householdId}` },
    },
    select: { id: true },
  });
  for (const p of legacy) ids.add(p.id);

  if (ids.size > 0) {
    await tx.purchase.deleteMany({ where: { id: { in: [...ids] } } });
  }

  if (batch) {
    await tx.tripExportBatch.delete({ where: { id: batch.id } });
  }

  await tx.trip.update({
    where: { id: tripId },
    data: {
      exportHouseholdId: null,
      exportBatchId: null,
      exportedAt: null,
    },
  });
}

function wrapExportError(error: unknown): Error {
  const nested =
    error instanceof Error && error.cause instanceof Error ? error.cause : error;
  if (nested instanceof ExpenseValidationError) {
    return new TripValidationError(nested.message);
  }
  if (error instanceof ExpenseValidationError) {
    return new TripValidationError(error.message);
  }
  const message = error instanceof Error ? error.message : '';
  if (
    message.includes('La suma de montos') ||
    message.includes('montos no pueden') ||
    message.includes('suma de lo pagado')
  ) {
    return new TripValidationError(message);
  }
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: string }).code === 'P2028'
  ) {
    return new TripValidationError('La exportación tardó demasiado. Probá de nuevo.');
  }
  if (error instanceof Error) return error;
  return new Error('No se pudo pasar el viaje a Biko');
}

function purchaseClientId(tripId: string, householdId: string): string {
  return `trip-export:${tripId}:${householdId}`;
}

function purchaseDescription(spec: TripExportPurchaseSpec): string {
  if (spec.coveredByOthers) {
    return 'Pasar a Biko · Viaje (lo pagó el grupo)';
  }
  return 'Pasar a Biko · Viaje';
}
