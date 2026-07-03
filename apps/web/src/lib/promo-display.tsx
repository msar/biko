import { promotionMatchesProvince, formatPromotionBenefit } from '@biko/shared';
import type { Promotion } from './types';

export function discountDisplay(promo: Promotion): { headline: string; sublabel: string | null } {
  return formatPromotionBenefit({
    discountKind: promo.discountKind,
    discountLabel: promo.discountLabel,
    discountPercentage: Number(promo.discountPercentage),
  });
}

export function filterPromosByLocation(promos: Promotion[], householdProvince: string | null): Promotion[] {
  if (!householdProvince) return promos;
  return promos.filter((p) => promotionMatchesProvince(p.provinces, householdProvince));
}
