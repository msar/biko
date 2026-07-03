import {
  PromotionInput,
  calculateDiscount,
  findCandidatePromotions,
  promotionMatchesHouseholdPaymentMethod,
} from '@biko/shared';
import { Prisma, PrismaClient } from '@prisma/client';

type Db = PrismaClient | Prisma.TransactionClient;

export function yearMonthOf(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function toPromotionInput(promo: {
  id: string;
  entityId: string;
  entity: { name: string };
  store: string | null;
  daysOfWeek: string[];
  categories?: Array<{ categoryId: string; category?: { name: string; icon: string | null } }>;
  paymentMethodType: string | null;
  cardNetwork: string | null;
  discountPercentage: Prisma.Decimal;
  discountCap: Prisma.Decimal | null;
  minPurchaseAmount: Prisma.Decimal | null;
  validFrom: Date | null;
  validTo: Date | null;
  active: boolean;
  discountKind?: string;
  discountLabel?: string | null;
  imageUrl?: string | null;
  storesAdherents?: boolean;
  provinces?: string[];
  notes?: string | null;
  sourceUrl?: string | null;
  details?: string[];
  sponsorBank?: string | null;
  sponsorBanks?: string[];
}): PromotionInput {
  return {
    id: promo.id,
    entityId: promo.entityId,
    entityName: promo.entity.name,
    store: promo.store,
    daysOfWeek: promo.daysOfWeek as PromotionInput['daysOfWeek'],
    categoryIds: promo.categories?.map((c) => c.categoryId) ?? [],
    paymentMethodType: promo.paymentMethodType as PromotionInput['paymentMethodType'],
    cardNetwork: promo.cardNetwork as PromotionInput['cardNetwork'],
    discountPercentage: promo.discountPercentage.toNumber(),
    discountCap: promo.discountCap?.toNumber() ?? null,
    minPurchaseAmount: promo.minPurchaseAmount?.toNumber() ?? null,
    validFrom: promo.validFrom?.toISOString() ?? null,
    validTo: promo.validTo?.toISOString() ?? null,
    active: promo.active,
    discountKind: promo.discountKind,
    discountLabel: promo.discountLabel,
    imageUrl: promo.imageUrl,
    storesAdherents: promo.storesAdherents,
    provinces: promo.provinces ?? [],
    notes: promo.notes,
    sourceUrl: promo.sourceUrl,
    details: promo.details ?? [],
    categoryNames: promo.categories?.map((c) => c.category?.name).filter(Boolean) as string[] | undefined,
    sponsorBank: promo.sponsorBank ?? null,
    sponsorBanks: promo.sponsorBanks ?? [],
  };
}

export const PROMOTION_INCLUDE = {
  entity: { select: { name: true } },
  categories: { select: { categoryId: true, category: { select: { name: true, icon: true } } } },
} as const;

export interface Suggestion {
  promotion: PromotionInput;
  /** Tope mensual restante de la entidad; null si la promo no tiene tope. */
  remainingCap: number | null;
  yearMonth: string;
  estimatedDiscount: number | null;
  estimatedNet: number | null;
}

async function getUsedAmount(db: Db, householdId: string, entityId: string, yearMonth: string): Promise<number> {
  const row = await db.monthlyCapUsage.findUnique({
    where: { householdId_entityId_yearMonth: { householdId, entityId, yearMonth } },
  });
  return row?.usedAmount.toNumber() ?? 0;
}

export async function incrementCapUsage(
  db: Db,
  householdId: string,
  entityId: string,
  yearMonth: string,
  amount: number,
): Promise<void> {
  if (amount <= 0) return;
  await db.monthlyCapUsage.upsert({
    where: { householdId_entityId_yearMonth: { householdId, entityId, yearMonth } },
    create: { householdId, entityId, yearMonth, usedAmount: amount },
    update: { usedAmount: { increment: amount } },
  });
}

/**
 * Sugiere la mejor promo aplicable a una compra, respetando el tope mensual
 * compartido por entidad: si el tope de un banco ya se consumió este mes, sus
 * promos se saltean aunque estén activas; otras entidades no se ven afectadas.
 */
export async function suggestPromotion(
  db: Db,
  params: {
    householdId: string;
    date: Date;
    store: string | null;
    grossAmount: number | null;
    categoryId?: string | null;
    paymentMethod: { entityId: string | null; entityName?: string; type: string; network: string };
    householdProvince?: string | null;
  },
): Promise<Suggestion | null> {
  const { householdId, date, store, grossAmount, categoryId = null, paymentMethod, householdProvince = null } =
    params;
  // Efectivo / medios sin entidad no participan de promociones bancarias.
  if (paymentMethod.entityId == null) return null;

  const promos = await db.promotion.findMany({
    where: {
      active: true,
      OR: [
        { entityId: paymentMethod.entityId },
        { sponsorBank: { not: null } },
        { sponsorBanks: { isEmpty: false } },
      ],
    },
    include: PROMOTION_INCLUDE,
  });

  const pmForMatch = {
    entityId: paymentMethod.entityId,
    entityName: paymentMethod.entityName ?? '',
    type: paymentMethod.type as never,
    network: paymentMethod.network as never,
  };

  const candidates = findCandidatePromotions({
    promotions: promos.map(toPromotionInput).filter((p) => promotionMatchesHouseholdPaymentMethod(pmForMatch, p)),
    paymentMethod: pmForMatch,
    date,
    store,
    grossAmount,
    categoryId,
    householdProvince,
  });

  const yearMonth = yearMonthOf(date);

  for (const candidate of candidates) {
    const promo = candidate.promotion;
    if (promo.discountCap == null) {
      const est = grossAmount != null ? calculateDiscount(grossAmount, promo.discountPercentage, null) : null;
      return {
        promotion: promo,
        remainingCap: null,
        yearMonth,
        estimatedDiscount: est?.discountAmount ?? null,
        estimatedNet: est?.netAmount ?? null,
      };
    }
    const used = await getUsedAmount(db, householdId, promo.entityId, yearMonth);
    const remainingCap = Math.max(promo.discountCap - used, 0);
    // Tope agotado: se saltea la promo aunque siga "activa".
    if (remainingCap <= 0) continue;
    const est = grossAmount != null ? calculateDiscount(grossAmount, promo.discountPercentage, remainingCap) : null;
    return {
      promotion: promo,
      remainingCap,
      yearMonth,
      estimatedDiscount: est?.discountAmount ?? null,
      estimatedNet: est?.netAmount ?? null,
    };
  }
  return null;
}

export interface ExpenseSuggestion {
  paymentMethodId: string;
  paymentMethodName: string;
  suggestion: Suggestion;
}

export interface ExpenseSuggestionResult {
  best: ExpenseSuggestion | null;
  alternatives: ExpenseSuggestion[];
}

/**
 * "¿Con qué pago?": corre la sugerencia para cada medio de pago del hogar y
 * devuelve el que más ahorra, con las alternativas ordenadas por descuento.
 */
export async function suggestForExpense(
  db: Db,
  params: {
    householdId: string;
    date: Date;
    store: string | null;
    grossAmount: number | null;
    categoryId?: string | null;
  },
): Promise<ExpenseSuggestionResult> {
  const methods = await db.paymentMethod.findMany({
    where: { householdId: params.householdId },
    include: { definition: { include: { entity: true } } },
  });

  const results: ExpenseSuggestion[] = [];
  for (const method of methods) {
    const suggestion = await suggestPromotion(db, {
      householdId: params.householdId,
      date: params.date,
      store: params.store,
      grossAmount: params.grossAmount,
      categoryId: params.categoryId,
      householdProvince: (
        await db.household.findUnique({
          where: { id: params.householdId },
          select: { province: true },
        })
      )?.province,
      paymentMethod: {
        entityId: method.definition.entityId,
        entityName: method.definition.entity?.name ?? method.definition.name,
        type: method.definition.type,
        network: method.definition.network,
      },
    });
    if (suggestion) {
      results.push({
        paymentMethodId: method.id,
        paymentMethodName: method.nickname ?? method.definition.name,
        suggestion,
      });
    }
  }

  results.sort((a, b) => {
    const discA = a.suggestion.estimatedDiscount ?? a.suggestion.promotion.discountPercentage;
    const discB = b.suggestion.estimatedDiscount ?? b.suggestion.promotion.discountPercentage;
    return discB - discA;
  });

  return { best: results[0] ?? null, alternatives: results.slice(1) };
}
