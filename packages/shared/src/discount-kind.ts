export const DiscountKind = {
  PERCENTAGE_REFUND: 'PERCENTAGE_REFUND',
  INSTALLMENTS: 'INSTALLMENTS',
  FIXED_AMOUNT: 'FIXED_AMOUNT',
  OTHER: 'OTHER',
} as const;

export type DiscountKind = (typeof DiscountKind)[keyof typeof DiscountKind];

export const DISCOUNT_KIND_LABEL: Record<DiscountKind, string> = {
  PERCENTAGE_REFUND: 'Reintegro %',
  INSTALLMENTS: 'Cuotas sin interés',
  FIXED_AMOUNT: 'Descuento fijo',
  OTHER: 'Otro beneficio',
};

export interface ParsedDiscount {
  kind: DiscountKind;
  label: string;
  percentage: number | null;
}

/** Parse discount type from MODO row/title copy. */
export function parseDiscountFromText(texts: string[]): ParsedDiscount | null {
  const joined = texts.filter(Boolean).join(' ');

  const installments = joined.match(/(\d+)\s*cuotas?\s*sin\s*inter[eé]s/i);
  if (installments) {
    return {
      kind: DiscountKind.INSTALLMENTS,
      label: `${installments[1]} cuotas sin interés`,
      percentage: null,
    };
  }

  const pctMatch = joined.match(/(\d{1,2}(?:[.,]\d+)?)\s*%\s*(?:de\s*)?reintegro/i) ?? joined.match(/(\d{1,2}(?:[.,]\d+)?)\s*%/);
  if (pctMatch) {
    const value = Number(pctMatch[1]!.replace(',', '.'));
    if (value > 0 && value <= 100) {
      return {
        kind: DiscountKind.PERCENTAGE_REFUND,
        label: `${value}% de reintegro`,
        percentage: value,
      };
    }
  }

  const fixed = joined.match(/\$\s*([\d.]+)/);
  if (fixed) {
    return { kind: DiscountKind.FIXED_AMOUNT, label: `Descuento $${fixed[1]}`, percentage: null };
  }

  return null;
}

export interface PromotionBenefitDisplay {
  headline: string;
  sublabel: string | null;
}

/** Texto legible del beneficio (no siempre es un % de reintegro). */
export function formatPromotionBenefit(promo: {
  discountKind?: string | null;
  discountLabel?: string | null;
  discountPercentage: number;
}): PromotionBenefitDisplay {
  if (promo.discountKind === DiscountKind.INSTALLMENTS) {
    return { headline: promo.discountLabel ?? 'Cuotas sin interés', sublabel: null };
  }
  if (promo.discountKind === DiscountKind.FIXED_AMOUNT) {
    return { headline: promo.discountLabel ?? 'Descuento fijo', sublabel: null };
  }
  if (promo.discountKind === DiscountKind.OTHER) {
    return { headline: promo.discountLabel ?? 'Beneficio', sublabel: null };
  }
  return {
    headline: `${promo.discountPercentage}%`,
    sublabel: promo.discountLabel ?? 'Reintegro',
  };
}
