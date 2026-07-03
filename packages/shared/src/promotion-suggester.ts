import { dayOfWeekFromDate } from './enums';
import { promotionMatchesHouseholdPaymentMethod } from './payment-method-matching';
import {
  HouseholdPaymentMethod,
  PromotionInput,
  isPromotionActiveOn,
  promotionMatchesCategory,
  promotionMatchesDay,
} from './promotion-recommender';
import { promotionMatchesProvince } from './provinces';

export interface SuggestionCandidate {
  promotion: PromotionInput;
  storeSpecific: boolean;
}

export function normalizeStoreName(store: string): string {
  return store
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ');
}

function isEmployeeOnlyPromo(promo: PromotionInput): boolean {
  const text = `${promo.notes ?? ''} ${promo.discountLabel ?? ''}`.toLowerCase();
  return /beneficio\s+empleados|solo\s+empleados|exclusivo\s+empleados/.test(text);
}

/** Promos MODO con locales adheridos por rubro/zona (ej. "Supermercados de Córdoba"). */
export function isRegionalGroupPromo(promo: PromotionInput): boolean {
  if (!promo.storesAdherents || !(promo.provinces?.length ?? 0)) return false;
  const name = `${promo.store ?? ''} ${promo.notes ?? ''} ${promo.discountLabel ?? ''}`.toLowerCase();
  return /supermercados?\s+de|supers\s+de|almacenes|comercios de/i.test(name);
}

/** Coincidencia flexible: exacta, substring o token compartido (Carnave ↔ Granjas Carnave). */
export function storesMatch(promoStore: string, userStore: string): boolean {
  const promoNorm = normalizeStoreName(promoStore);
  const userNorm = normalizeStoreName(userStore);
  if (!promoNorm || !userNorm) return false;
  if (promoNorm === userNorm) return true;
  if (promoNorm.includes(userNorm) && userNorm.length >= 4) return true;
  if (userNorm.includes(promoNorm) && promoNorm.length >= 4) return true;

  const userTokens = userNorm.split(' ').filter((t) => t.length >= 4);
  const promoTokens = promoNorm.split(' ').filter((t) => t.length >= 4);
  return userTokens.some((t) => promoTokens.some((p) => p.includes(t) || t.includes(p)));
}

/**
 * Promo regional con locales adheridos cuando el usuario ingresa un comercio concreto
 * (ej. Carnave en "Supermercados de Córdoba"). No exige rubro del gasto: adherentes
 * incluyen pollerías y otros rubros además de supermercados.
 */
function regionalGroupStoreContextMatches(
  promo: PromotionInput,
  store: string | null,
  householdProvince: string | null,
): boolean {
  if (!isRegionalGroupPromo(promo)) return false;
  if (!store || normalizeStoreName(store).length < 3) return false;
  if (!householdProvince || !promotionMatchesProvince(promo.provinces ?? [], householdProvince)) return false;
  return true;
}

function promotionMatchesCategoryForPurchase(
  promo: PromotionInput,
  categoryId: string | null,
  store: string | null,
  householdProvince: string | null,
): boolean {
  if (promotionMatchesCategory(promo, categoryId)) return true;
  return regionalGroupStoreContextMatches(promo, store, householdProvince);
}

function promotionMatchesStore(
  promo: PromotionInput,
  store: string | null,
  householdProvince: string | null,
): boolean {
  if (store == null || store.trim() === '') {
    return true;
  }

  if (promo.store != null && storesMatch(promo.store, store)) return true;

  if (regionalGroupStoreContextMatches(promo, store, householdProvince)) return true;

  return false;
}

/**
 * Filtra y ordena las promos candidatas para una compra puntual:
 * entidad + día + comercio (o promo sin comercio) + tipo/red del medio de pago
 * + vigencia + monto mínimo. Las promos específicas del comercio van primero.
 *
 * El chequeo de tope mensual restante NO se hace acá: es responsabilidad del
 * caller (server-side con MonthlyCapUsage; el front lo usa solo como estimación
 * offline).
 */
export function findCandidatePromotions(params: {
  promotions: PromotionInput[];
  paymentMethod: Pick<HouseholdPaymentMethod, 'entityId' | 'entityName' | 'type' | 'network'>;
  date: Date;
  store: string | null;
  grossAmount: number | null;
  categoryId?: string | null;
  householdProvince?: string | null;
}): SuggestionCandidate[] {
  const { promotions, paymentMethod, date, store, grossAmount, categoryId = null, householdProvince = null } =
    params;
  const day = dayOfWeekFromDate(date);

  return promotions
    .filter((promo) => isPromotionActiveOn(promo, date))
    .filter((promo) => promotionMatchesDay(promo, day))
    .filter((promo) => promotionMatchesCategoryForPurchase(promo, categoryId, store, householdProvince))
    .filter((promo) => promotionMatchesProvince(promo.provinces ?? [], householdProvince))
    .filter((promo) => promo.discountKind !== 'INSTALLMENTS' && promo.discountPercentage > 0)
    .filter((promo) => !isEmployeeOnlyPromo(promo))
    .filter((promo) => promotionMatchesHouseholdPaymentMethod(paymentMethod, promo))
    .filter((promo) => promotionMatchesStore(promo, store, householdProvince))
    .filter((promo) => {
      if (promo.minPurchaseAmount == null || grossAmount == null) return true;
      return grossAmount >= promo.minPurchaseAmount;
    })
    .map((promo) => ({
      promotion: promo,
      storeSpecific:
        store != null &&
        promo.store != null &&
        storesMatch(promo.store, store) &&
        !isRegionalGroupPromo(promo),
    }))
    .sort((a, b) => {
      if (a.storeSpecific !== b.storeSpecific) return a.storeSpecific ? -1 : 1;
      return b.promotion.discountPercentage - a.promotion.discountPercentage;
    });
}
