import { buildPurchaseAllocations, calculateDiscount, generateInstallments } from '@biko/shared';
import type { Prisma, PrismaClient } from '@prisma/client';
import type { Decimal } from '@prisma/client/runtime/library';
import { incrementCapUsage, suggestPromotion, yearMonthOf } from './promotion-suggestion.js';

type Db = PrismaClient | Prisma.TransactionClient;

export const purchaseInclude = {
  category: true,
  user: { select: { id: true, name: true } },
  paymentMethod: { include: { definition: { include: { entity: true } } } },
  promotion: { include: { entity: true } },
  installments: { orderBy: { number: 'asc' as const } },
  allocations: { include: { user: { select: { id: true, name: true } } } },
};

export interface ExpenseInput {
  paymentMethodId: string;
  categoryId: string;
  store: string;
  description?: string | null;
  purchaseDate: Date;
  grossAmount: number;
  installmentsCount: number;
  applyPromotion: boolean;
  scope: 'HOUSEHOLD' | 'PERSONAL';
  myShareAmount?: number;
}

async function getHouseholdMemberIds(db: Db, householdId: string): Promise<string[]> {
  const users = await db.user.findMany({
    where: { householdId },
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  return users.map((u) => u.id);
}

export async function rollbackPurchaseCapUsage(
  tx: Prisma.TransactionClient,
  purchase: {
    householdId: string;
    promotionId: string | null;
    promotion: { entityId: string } | null;
    discountAmount: Decimal;
    purchaseDate: Date;
  },
): Promise<void> {
  if (purchase.promotionId && purchase.promotion && purchase.discountAmount.toNumber() > 0) {
    const yearMonth = yearMonthOf(purchase.purchaseDate);
    await tx.monthlyCapUsage.updateMany({
      where: { householdId: purchase.householdId, entityId: purchase.promotion.entityId, yearMonth },
      data: { usedAmount: { decrement: purchase.discountAmount } },
    });
  }
}

export async function createPurchaseWithAllocations(
  tx: Prisma.TransactionClient,
  householdId: string,
  userId: string,
  body: ExpenseInput,
  clientId?: string,
) {
  const paymentMethod = await tx.paymentMethod.findFirst({
    where: { id: body.paymentMethodId, householdId },
    include: { definition: true },
  });
  if (!paymentMethod) throw new ExpenseValidationError('Medio de pago inválido');

  const category = await tx.category.findFirst({
    where: { id: body.categoryId, OR: [{ householdId: null }, { householdId }] },
  });
  if (!category) throw new ExpenseValidationError('Categoría inválida');

  const suggestion = body.applyPromotion
    ? await suggestPromotion(tx, {
        householdId,
        date: body.purchaseDate,
        store: body.store,
        grossAmount: body.grossAmount,
        categoryId: category.id,
        paymentMethod: {
          entityId: paymentMethod.definition.entityId,
          type: paymentMethod.definition.type,
          network: paymentMethod.definition.network,
        },
      })
    : null;

  const { discountAmount, netAmount } = calculateDiscount(
    body.grossAmount,
    suggestion?.promotion.discountPercentage ?? null,
    suggestion?.remainingCap ?? null,
  );

  if (body.scope === 'HOUSEHOLD' && body.myShareAmount != null && body.myShareAmount > netAmount) {
    throw new ExpenseValidationError('Mi parte no puede superar el total neto');
  }

  const memberIds = await getHouseholdMemberIds(tx, householdId);
  const allocationEntries = buildPurchaseAllocations({
    scope: body.scope,
    netAmount,
    userId,
    memberIds,
    myShareAmount: body.scope === 'HOUSEHOLD' ? body.myShareAmount : undefined,
  });

  const installments = generateInstallments(netAmount, body.installmentsCount, body.purchaseDate, {
    type: paymentMethod.definition.type,
    closingDay: paymentMethod.closingDay,
    dueDay: paymentMethod.dueDay,
  });
  const isImmediate = paymentMethod.definition.type !== 'CREDIT_CARD';

  const created = await tx.purchase.create({
    data: {
      clientId,
      householdId,
      userId,
      paymentMethodId: paymentMethod.id,
      categoryId: category.id,
      store: body.store,
      description: body.description,
      purchaseDate: body.purchaseDate,
      grossAmount: body.grossAmount,
      promotionId: suggestion?.promotion.id ?? null,
      discountPercentageApplied: suggestion?.promotion.discountPercentage ?? null,
      discountCapApplied: suggestion?.remainingCap ?? null,
      discountAmount,
      netAmount,
      installmentsCount: isImmediate ? 1 : body.installmentsCount,
      scope: body.scope,
      installments: {
        create: installments.map((inst) => ({
          householdId,
          number: inst.number,
          amount: inst.amount,
          dueDate: inst.dueDate,
          paid: isImmediate,
          paidDate: isImmediate ? body.purchaseDate : null,
        })),
      },
      allocations: {
        create: allocationEntries.map((a) => ({
          userId: a.userId,
          amount: a.amount,
        })),
      },
    },
    include: purchaseInclude,
  });

  if (suggestion && discountAmount > 0) {
    await incrementCapUsage(
      tx,
      householdId,
      suggestion.promotion.entityId,
      yearMonthOf(body.purchaseDate),
      discountAmount,
    );
  }

  return created;
}

export async function updatePurchaseWithAllocations(
  tx: Prisma.TransactionClient,
  purchaseId: string,
  householdId: string,
  userId: string,
  body: ExpenseInput,
) {
  const existing = await tx.purchase.findFirst({
    where: { id: purchaseId, householdId },
    include: { promotion: true },
  });
  if (!existing) throw new ExpenseNotFoundError();

  await rollbackPurchaseCapUsage(tx, existing);
  await tx.installment.deleteMany({ where: { purchaseId } });
  await tx.purchaseAllocation.deleteMany({ where: { purchaseId } });

  const paymentMethod = await tx.paymentMethod.findFirst({
    where: { id: body.paymentMethodId, householdId },
    include: { definition: true },
  });
  if (!paymentMethod) throw new ExpenseValidationError('Medio de pago inválido');

  const category = await tx.category.findFirst({
    where: { id: body.categoryId, OR: [{ householdId: null }, { householdId }] },
  });
  if (!category) throw new ExpenseValidationError('Categoría inválida');

  const suggestion = body.applyPromotion
    ? await suggestPromotion(tx, {
        householdId,
        date: body.purchaseDate,
        store: body.store,
        grossAmount: body.grossAmount,
        categoryId: category.id,
        paymentMethod: {
          entityId: paymentMethod.definition.entityId,
          type: paymentMethod.definition.type,
          network: paymentMethod.definition.network,
        },
      })
    : null;

  const { discountAmount, netAmount } = calculateDiscount(
    body.grossAmount,
    suggestion?.promotion.discountPercentage ?? null,
    suggestion?.remainingCap ?? null,
  );

  if (body.scope === 'HOUSEHOLD' && body.myShareAmount != null && body.myShareAmount > netAmount) {
    throw new ExpenseValidationError('Mi parte no puede superar el total neto');
  }

  const memberIds = await getHouseholdMemberIds(tx, householdId);
  const allocationEntries = buildPurchaseAllocations({
    scope: body.scope,
    netAmount,
    userId,
    memberIds,
    myShareAmount: body.scope === 'HOUSEHOLD' ? body.myShareAmount : undefined,
  });

  const installments = generateInstallments(netAmount, body.installmentsCount, body.purchaseDate, {
    type: paymentMethod.definition.type,
    closingDay: paymentMethod.closingDay,
    dueDay: paymentMethod.dueDay,
  });
  const isImmediate = paymentMethod.definition.type !== 'CREDIT_CARD';

  const updated = await tx.purchase.update({
    where: { id: purchaseId },
    data: {
      paymentMethodId: paymentMethod.id,
      categoryId: category.id,
      store: body.store,
      description: body.description,
      purchaseDate: body.purchaseDate,
      grossAmount: body.grossAmount,
      promotionId: suggestion?.promotion.id ?? null,
      discountPercentageApplied: suggestion?.promotion.discountPercentage ?? null,
      discountCapApplied: suggestion?.remainingCap ?? null,
      discountAmount,
      netAmount,
      installmentsCount: isImmediate ? 1 : body.installmentsCount,
      scope: body.scope,
      installments: {
        create: installments.map((inst) => ({
          householdId,
          number: inst.number,
          amount: inst.amount,
          dueDate: inst.dueDate,
          paid: isImmediate,
          paidDate: isImmediate ? body.purchaseDate : null,
        })),
      },
      allocations: {
        create: allocationEntries.map((a) => ({
          userId: a.userId,
          amount: a.amount,
        })),
      },
    },
    include: purchaseInclude,
  });

  if (suggestion && discountAmount > 0) {
    await incrementCapUsage(
      tx,
      householdId,
      suggestion.promotion.entityId,
      yearMonthOf(body.purchaseDate),
      discountAmount,
    );
  }

  return updated;
}

export class ExpenseValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExpenseValidationError';
  }
}

export class ExpenseNotFoundError extends Error {
  constructor() {
    super('Gasto no encontrado');
    this.name = 'ExpenseNotFoundError';
  }
}
