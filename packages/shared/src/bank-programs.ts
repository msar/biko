/** Known household bank programs / paid tiers (self-declared in Ajustes). */
export const BANK_PROGRAMS = [
  'SANTANDER_SELECT',
  'SANTANDER_SORPRESA',
  'GALICIA_EMINENT',
] as const;

export type BankProgram = (typeof BANK_PROGRAMS)[number];

export const BANK_PROGRAM_LABEL: Record<BankProgram, string> = {
  SANTANDER_SELECT: 'Santander Select',
  SANTANDER_SORPRESA: 'Santander Sorpresa',
  GALICIA_EMINENT: 'Galicia Eminent',
};

export function isBankProgram(value: string): value is BankProgram {
  return (BANK_PROGRAMS as readonly string[]).includes(value);
}

export function normalizeBankPrograms(values: readonly string[]): BankProgram[] {
  const seen = new Set<BankProgram>();
  for (const value of values) {
    if (isBankProgram(value)) seen.add(value);
  }
  return [...seen];
}

/**
 * Exclusive promo (non-empty audienceSegments) is visible only if the household
 * has at least one matching bank program. Empty segments = open to any customer.
 */
export function promotionMatchesAudience(
  promoSegments: readonly string[] | null | undefined,
  householdPrograms: readonly string[] | null | undefined,
): boolean {
  const segments = promoSegments ?? [];
  if (segments.length === 0) return true;
  const programs = new Set(householdPrograms ?? []);
  return segments.some((s) => programs.has(s));
}
