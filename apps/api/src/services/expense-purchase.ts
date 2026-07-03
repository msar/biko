import { buildPurchaseAllocations, calculateDiscount, generateInstallments } from '@biko/shared';
import type { Prisma, PrismaClient } from '@prisma/client';
import type { Decimal } from '@prisma/client/runtime/library';
import {
  applyPromotionById,
  incrementCapUsage,
  suggestPromotion,
  yearMonthOf,
} from './promotion-suggestion.js';

type Db = PrismaClient | Prisma.TransactionClient;

export const purchaseInclude = {
  category: true,
  user: { select: { id: true, name: true } },
  paymentMethod: { include: { definition: { include: { entity: true } } } },
  promotion: { include: { entity: true } },
  installments: { orderBy: { number: 'asc' as const } },
  allocations: { include: { user: { select: { id: true, name: true } } } },
};

export type PromotionApplyMode = 'auto' | 'manual' | 'off';

export interface ManualDiscountInput {
  label?: string | null;
  discountPercentage: number;
  discountCap?: number | null;
}

export interface ExpenseInput {
  paymentMethodId: string;
  categoryId: string;
  store: string;
  description?: string | null;
  purchaseDate: Date;
  grossAmount: number;
  installmentsCount: number;
  /** @deprecated use promotionMode */
  applyPromotion?: boolean;
  promotionMode?: PromotionApplyMode;
  promotionId?: string;
  manualDiscount?: ManualDiscountInput;
  scope: 'HOUSEHOLD' | 'PERSONAL';
  myShareAmount?: number;
}

interface ResolvedDiscount {
  promotionId: string | null;
  discountPercentageApplied: number | null;
  discountCapApplied: number | null;
  discountLabelApplied: string | null;
  discountAmount: number;
  netAmount: number;
  capUsage: { entityId: string; amount: number } | null;
}

async function getHouseholdMemberIds(db: Db, householdId: string): Promise<string[]> {
  const users = await db.user.findMany({
    where: { householdId },
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  return users.map((u) => u.id);
}

export function resolvePromotionMode(body: Pick<ExpenseInput, 'promotionMode' | 'applyPromotion'>): PromotionApplyMode {
  if (body.promotionMode) return body.promotionMode;
  return body.applyPromotion === false ? 'off' : 'auto';
}

async function resolveExpenseDiscount(
  tx: Prisma.TransactionClient,
  householdId: string,
  body: ExpenseInput,
  paymentMethod: { definition: { entityId: string | null; entity: { name: string } | null; name: string; type: string; network: string } },
  categoryId: string,
  householdProvince: string | null,
): Promise<ResolvedDiscount> {
  const mode = resolvePromotionMode(body);
  const noDiscount: ResolvedDiscount = {
    promotionId: null,
    discountPercentageApplied: null,
    discountCapApplied: null,
    discountLabelApplied: null,
    discountAmount: 0,
    netAmount: body.grossAmount,
    capUsage: null,
  };

  if (mode === 'off') return noDiscount;

  if (mode === 'manual') {
    if (body.promotionId) {
      const applied = await applyPromotionById(tx, {
        householdId,
        date: body.purchaseDate,
        grossAmount: body.grossAmount,
        promotionId: body.promotionId,
      });
      if (!applied) {
        throw new ExpenseValidationError('Promoción inválida o tope mensual agotado');
      }
      const { discountAmount, netAmount } = calculateDiscount(
        body.grossAmount,
        applied.promotion.discountPercentage,
        applied.remainingCap,
      );
      const label =
        applied.promotion.discountLabel ??
        (applied.promotion.store
          ? `${applied.promotion.discountPercentage}% ${applied.promotion.store}`
          : `${applied.promotion.discountPercentage}% ${applied.promotion.entityName}`);
      return {
        promotionId: applied.promotion.id,
        discountPercentageApplied: applied.promotion.discountPercentage,
        discountCapApplied: applied.remainingCap,
        discountLabelApplied: label,
        discountAmount,
        netAmount,
        capUsage:
          discountAmount > 0 ? { entityId: applied.promotion.entityId, amount: discountAmount } : null,
      };
    }

    if (body.manualDiscount) {
      const cap = body.manualDiscount.discountCap ?? null;
      const { discountAmount, netAmount } = calculateDiscount(
        body.grossAmount,
        body.manualDiscount.discountPercentage,
        cap,
      );
      return {
        promotionId: null,
        discountPercentageApplied: body.manualDiscount.discountPercentage,
        discountCapApplied: cap,
        discountLabelApplied: body.manualDiscount.label?.trim() || null,
        discountAmount,
        netAmount,
        capUsage: null,
      };
    }

    throw new ExpenseValidationError('Indicá una promoción o un descuento manual');
  }

  const suggestion = await suggestPromotion(tx, {
    householdId,
    date: body.purchaseDate,
    store: body.store,
    grossAmount: body.grossAmount,
    categoryId,
    householdProvince,
    paymentMethod: {
      entityId: paymentMethod.definition.entityId,
      entityName: paymentMethod.definition.entity?.name ?? paymentMethod.definition.name,
      type: paymentMethod.definition.type,
      network: paymentMethod.definition.network,
    },
  });

  if (!suggestion) return noDiscount;

  const { discountAmount, netAmount } = calculateDiscount(
    body.grossAmount,
    suggestion.promotion.discountPercentage,
    suggestion.remainingCap,
  );

  return {
    promotionId: suggestion.promotion.id,
    discountPercentageApplied: suggestion.promotion.discountPercentage,
    discountCapApplied: suggestion.remainingCap,
    discountLabelApplied: null,
    discountAmount,
    netAmount,
    capUsage: discountAmount > 0 ? { entityId: suggestion.promotion.entityId, amount: discountAmount } : null,
  };
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

async function persistPurchaseDiscountCap(
  tx: Prisma.TransactionClient,
  householdId: string,
  purchaseDate: Date,
  capUsage: ResolvedDiscount['capUsage'],
): Promise<void> {
  if (!capUsage || capUsage.amount <= 0) return;
  await incrementCapUsage(tx, householdId, capUsage.entityId, yearMonthOf(purchaseDate), capUsage.amount);
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
    include: { definition: { include: { entity: true } } },
  });
  if (!paymentMethod) throw new ExpenseValidationError('Medio de pago inválido');

  const category = await tx.category.findFirst({
    where: { id: body.categoryId, OR: [{ householdId: null }, { householdId }] },
  });
  if (!category) throw new ExpenseValidationError('Categoría inválida');

  const household = await tx.household.findUniqueOrThrow({
    where: { id: householdId },
    select: { province: true },
  });

  const discount = await resolveExpenseDiscount(
    tx,
    householdId,
    body,
    paymentMethod,
    category.id,
    household.province,
  );

  if (body.scope === 'HOUSEHOLD' && body.myShareAmount != null && body.myShareAmount > discount.netAmount) {
    throw new ExpenseValidationError('Mi parte no puede superar el total neto');
  }

  const memberIds = await getHouseholdMemberIds(tx, householdId);
  const allocationEntries = buildPurchaseAllocations({
    scope: body.scope,
    netAmount: discount.netAmount,
    userId,
    memberIds,
    myShareAmount: body.scope === 'HOUSEHOLD' ? body.myShareAmount : undefined,
  });

  const installments = generateInstallments(discount.netAmount, body.installmentsCount, body.purchaseDate, {
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
      promotionId: discount.promotionId,
      discountPercentageApplied: discount.discountPercentageApplied,
      discountCapApplied: discount.discountCapApplied,
      discountLabelApplied: discount.discountLabelApplied,
      discountAmount: discount.discountAmount,
      netAmount: discount.netAmount,
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

  await persistPurchaseDiscountCap(tx, householdId, body.purchaseDate, discount.capUsage);

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
    include: { definition: { include: { entity: true } } },
  });
  if (!paymentMethod) throw new ExpenseValidationError('Medio de pago inválido');

  const category = await tx.category.findFirst({
    where: { id: body.categoryId, OR: [{ householdId: null }, { householdId }] },
  });
  if (!category) throw new ExpenseValidationError('Categoría inválida');

  const household = await tx.household.findUniqueOrThrow({
    where: { id: householdId },
    select: { province: true },
  });

  const discount = await resolveExpenseDiscount(
    tx,
    householdId,
    body,
    paymentMethod,
    category.id,
    household.province,
  );

  if (body.scope === 'HOUSEHOLD' && body.myShareAmount != null && body.myShareAmount > discount.netAmount) {
    throw new ExpenseValidationError('Mi parte no puede superar el total neto');
  }

  const memberIds = await getHouseholdMemberIds(tx, householdId);
  const allocationEntries = buildPurchaseAllocations({
    scope: body.scope,
    netAmount: discount.netAmount,
    userId,
    memberIds,
    myShareAmount: body.scope === 'HOUSEHOLD' ? body.myShareAmount : undefined,
  });

  const installments = generateInstallments(discount.netAmount, body.installmentsCount, body.purchaseDate, {
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
      promotionId: discount.promotionId,
      discountPercentageApplied: discount.discountPercentageApplied,
      discountCapApplied: discount.discountCapApplied,
      discountLabelApplied: discount.discountLabelApplied,
      discountAmount: discount.discountAmount,
      netAmount: discount.netAmount,
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

  await persistPurchaseDiscountCap(tx, householdId, body.purchaseDate, discount.capUsage);

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
