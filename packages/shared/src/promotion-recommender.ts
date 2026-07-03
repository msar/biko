import { CardNetwork, DayOfWeek, PaymentMethodType } from './enums';
import { findHouseholdPaymentMethodForPromo } from './payment-method-matching';
import { promotionMatchesProvince } from './provinces';
import { isActionableWeeklyPromo } from './weekly-promo-quality';

export interface HouseholdPaymentMethod {
  id: string;
  entityId: string | null; // null solo para Efectivo (sin entidad)
  entityName: string;
  type: PaymentMethodType;
  network: CardNetwork;
}

export interface PromotionInput {
  id: string;
  entityId: string;
  entityName: string;
  store: string | null; // null = aplica a cualquier comercio
  daysOfWeek: DayOfWeek[]; // vacío = todos los días
  categoryIds: string[]; // vacío = sin rubro declarado (matchea cualquiera)
  paymentMethodType: PaymentMethodType | null;
  cardNetwork: CardNetwork | null; // null = cualquier red (ej. promo "solo Visa" => VISA)
  discountPercentage: number;
  discountCap: number | null;
  minPurchaseAmount: number | null;
  validFrom: string | null; // ISO date
  validTo: string | null;
  active: boolean;
  /** Vacío = nacional. */
  provinces?: string[];
  discountKind?: string;
  discountLabel?: string | null;
  imageUrl?: string | null;
  storesAdherents?: boolean;
  categoryNames?: string[];
  notes?: string | null;
  sourceUrl?: string | null;
  details?: string[];
  /** Banco patrocinador en MODO (singular, legacy). */
  sponsorBank?: string | null;
  /** Bancos adheridos en MODO; si hay varios, matchea cualquiera del hogar. */
  sponsorBanks?: string[];
}

/** Rubros de compras frecuentes del hogar (Mi semana). */
export const WEEKLY_ESSENTIAL_CATEGORY_NAMES = [
  'Supermercado',
  'Verdulería',
  'Carnicería',
  'Pollería',
  'Panadería',
  'Combustible',
  'Farmacia',
] as const;

export type CategoryFilter =
  | { mode: 'single'; id: string }
  | { mode: 'any'; ids: string[] }
  | null;

export interface DayRecommendation {
  dayOfWeek: DayOfWeek;
  promotions: Array<{
    promotionId: string;
    entityId: string;
    entityName: string;
    store: string | null;
    discountPercentage: number;
    discountCap: number | null;
    matchedPaymentMethodId: string;
    discountKind?: string;
    discountLabel?: string | null;
    imageUrl?: string | null;
    storesAdherents?: boolean;
    categoryNames?: string[];
    notes?: string | null;
    sourceUrl?: string | null;
    minPurchaseAmount?: number | null;
    details?: string[];
  }>;
}

const WEEK: DayOfWeek[] = [
  DayOfWeek.MONDAY,
  DayOfWeek.TUESDAY,
  DayOfWeek.WEDNESDAY,
  DayOfWeek.THURSDAY,
  DayOfWeek.FRIDAY,
  DayOfWeek.SATURDAY,
  DayOfWeek.SUNDAY,
];

/**
 * Un medio de pago del hogar "sirve" para una promo si coincide la entidad
 * (por id, no por string), el tipo (si la promo lo restringe) y la red de
 * tarjeta (si la promo es, por ej., solo Visa).
 */
export function paymentMethodMatchesPromotion(
  pm: Pick<HouseholdPaymentMethod, 'entityId' | 'type' | 'network'>,
  promo: Pick<PromotionInput, 'entityId' | 'paymentMethodType' | 'cardNetwork'>,
): boolean {
  if (pm.entityId !== promo.entityId) return false;
  if (promo.paymentMethodType != null && pm.type !== promo.paymentMethodType) return false;
  if (promo.cardNetwork != null && promo.cardNetwork !== CardNetwork.NONE && pm.network !== promo.cardNetwork) {
    return false;
  }
  return true;
}

/** Una promo aplica un día si no declara días (todos) o si lo incluye. */
export function promotionMatchesDay(promo: Pick<PromotionInput, 'daysOfWeek'>, day: DayOfWeek): boolean {
  return promo.daysOfWeek.length === 0 || promo.daysOfWeek.includes(day);
}

/**
 * Una promo aplica a una categoría si no declara rubros (promo genérica /
 * cargada a mano sin rubro) o si la incluye.
 */
export function promotionMatchesCategory(
  promo: Pick<PromotionInput, 'categoryIds'>,
  categoryId: string | null,
): boolean {
  if (categoryId == null || promo.categoryIds.length === 0) return true;
  return promo.categoryIds.includes(categoryId);
}

/** Promo matchea si declara al menos un rubro del allowlist (estricto: sin rubro = no matchea). */
export function promotionMatchesAnyCategory(
  promo: Pick<PromotionInput, 'categoryIds'>,
  allowedCategoryIds: string[],
): boolean {
  if (allowedCategoryIds.length === 0) return true;
  if (promo.categoryIds.length === 0) return false;
  return promo.categoryIds.some((id) => allowedCategoryIds.includes(id));
}

function promotionMatchesCategoryFilter(
  promo: Pick<PromotionInput, 'categoryIds'>,
  filter: CategoryFilter,
): boolean {
  if (filter == null) return true;
  if (filter.mode === 'single') return promotionMatchesCategory(promo, filter.id);
  return promotionMatchesAnyCategory(promo, filter.ids);
}

export function isPromotionActiveOn(
  promo: Pick<PromotionInput, 'active' | 'validFrom' | 'validTo'>,
  date: Date,
): boolean {
  if (!promo.active) return false;
  if (promo.validFrom != null && date < new Date(promo.validFrom)) return false;
  if (promo.validTo != null && date > new Date(promo.validTo)) return false;
  return true;
}

/**
 * Arma el calendario semanal: para cada día, qué promociones son aprovechables
 * dado que solo importan las que coinciden con un medio de pago que el hogar
 * realmente tiene cargado.
 */
export function getWeeklyRecommendations(
  householdPaymentMethods: HouseholdPaymentMethod[],
  promotions: PromotionInput[],
  referenceDate: Date = new Date(),
  categoryFilter: CategoryFilter = null,
  householdProvince: string | null = null,
  options: { essentialsOnly?: boolean; banksOnly?: boolean } = {},
): DayRecommendation[] {
  const { essentialsOnly = false, banksOnly = false } = options;
  return WEEK.map((day) => ({
    dayOfWeek: day,
    promotions: promotions
      .filter((promo) => promo.active)
      .filter((promo) => isPromotionActiveOn(promo, referenceDate))
      .filter((promo) => promotionMatchesDay(promo, day))
      .filter((promo) => promotionMatchesCategoryFilter(promo, categoryFilter))
      .filter((promo) => promotionMatchesProvince(promo.provinces ?? [], householdProvince))
      .filter((promo) => promo.discountKind !== 'INSTALLMENTS' && promo.discountPercentage > 0)
      .filter((promo) => !essentialsOnly || isActionableWeeklyPromo(promo))
      .flatMap((promo) => {
        const match = findHouseholdPaymentMethodForPromo(householdPaymentMethods, promo, { banksOnly });
        if (!match) return [];
        return [
          {
            promotionId: promo.id,
            entityId: promo.entityId,
            entityName: match.entityName,
            store: promo.store,
            discountPercentage: promo.discountPercentage,
            discountCap: promo.discountCap,
            matchedPaymentMethodId: match.id,
            discountKind: promo.discountKind,
            discountLabel: promo.discountLabel,
            imageUrl: promo.imageUrl,
            storesAdherents: promo.storesAdherents,
            categoryNames: promo.categoryNames,
            notes: promo.notes,
            sourceUrl: promo.sourceUrl,
            minPurchaseAmount: promo.minPurchaseAmount,
            details: promo.details,
          },
        ];
      })
      .sort((a, b) => b.discountPercentage - a.discountPercentage),
  }));
}

export interface CategoryDaySchedule {
  dayOfWeek: DayOfWeek;
  bestDiscount: number;
  promotions: DayRecommendation['promotions'];
}

/**
 * "¿Cuándo conviene ir?" para una categoría: días ordenados por mejor
 * descuento aprovechable (solo promos que matchean la categoría y algún
 * medio de pago del hogar). Días sin promos no se incluyen.
 */
export function getCategorySchedule(
  categoryId: string,
  householdPaymentMethods: HouseholdPaymentMethod[],
  promotions: PromotionInput[],
  referenceDate: Date = new Date(),
  householdProvince: string | null = null,
): CategoryDaySchedule[] {
  return getWeeklyRecommendations(
    householdPaymentMethods,
    promotions,
    referenceDate,
    { mode: 'single', id: categoryId },
    householdProvince,
  )
    .filter((day) => day.promotions.length > 0)
    .map((day) => ({
      dayOfWeek: day.dayOfWeek,
      bestDiscount: Math.max(...day.promotions.map((p) => p.discountPercentage)),
      promotions: [...day.promotions].sort((a, b) => b.discountPercentage - a.discountPercentage),
    }))
    .sort((a, b) => b.bestDiscount - a.bestDiscount);
}
