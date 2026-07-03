import type { HouseholdPaymentMethod, PromotionInput } from './promotion-recommender';
import { PaymentMethodType } from './enums';
import { entityNamesMatch } from './entity-names';
import { paymentMethodMatchesPromotion } from './promotion-recommender';

export type PromoPaymentMatch = Pick<
  PromotionInput,
  'entityId' | 'sponsorBank' | 'sponsorBanks' | 'paymentMethodType' | 'cardNetwork'
>;

export function promoSponsorBanks(promo: Pick<PromotionInput, 'sponsorBank' | 'sponsorBanks'>): string[] {
  if (promo.sponsorBanks?.length) return promo.sponsorBanks;
  if (promo.sponsorBank) return [promo.sponsorBank];
  return [];
}

export function isBankPaymentMethod(
  pm: Pick<HouseholdPaymentMethod, 'type' | 'entityId'>,
): boolean {
  return (
    pm.entityId != null &&
    pm.type !== PaymentMethodType.WALLET &&
    pm.type !== PaymentMethodType.CASH
  );
}

function paymentMethodMatchesSponsorBanks(
  pm: Pick<HouseholdPaymentMethod, 'entityId' | 'entityName'>,
  banks: string[],
): boolean {
  if (banks.length === 0 || pm.entityId == null) return false;
  return banks.some((bank) => entityNamesMatch(pm.entityName, bank));
}

/**
 * Una promo aplica a un medio de pago del hogar si:
 * - tiene sponsorBanks / sponsorBank: el banco del medio debe estar en la lista
 * - si no: matchea por entityId / tipo / red como antes
 */
export function promotionMatchesHouseholdPaymentMethod(
  pm: Pick<HouseholdPaymentMethod, 'entityId' | 'entityName' | 'type' | 'network'>,
  promo: PromoPaymentMatch,
): boolean {
  const banks = promoSponsorBanks(promo);
  if (banks.length > 0) return paymentMethodMatchesSponsorBanks(pm, banks);
  return paymentMethodMatchesPromotion(pm, promo);
}

/** Medio de pago del hogar que habilita una promo (opcionalmente solo tarjetas de banco). */
export function findHouseholdPaymentMethodForPromo(
  methods: HouseholdPaymentMethod[],
  promo: PromoPaymentMatch,
  options: { banksOnly?: boolean } = {},
): HouseholdPaymentMethod | undefined {
  const banks = promoSponsorBanks(promo);
  const matches = methods.filter((pm) => promotionMatchesHouseholdPaymentMethod(pm, promo));
  if (!options.banksOnly) return matches[0];
  return matches.find((pm) => {
    if (!isBankPaymentMethod(pm)) return false;
    if (banks.length > 0) return paymentMethodMatchesSponsorBanks(pm, banks);
    return paymentMethodMatchesPromotion(pm, promo);
  });
}

export function householdHasMatchingPaymentMethod(
  methods: HouseholdPaymentMethod[],
  promo: PromoPaymentMatch,
  options: { banksOnly?: boolean } = {},
): boolean {
  return findHouseholdPaymentMethodForPromo(methods, promo, options) != null;
}
