import { describe, expect, it } from 'vitest';
import {
  normalizeBankPrograms,
  promotionMatchesAudience,
} from './bank-programs';

describe('normalizeBankPrograms', () => {
  it('keeps only known codes and dedupes', () => {
    expect(
      normalizeBankPrograms(['SANTANDER_SORPRESA', 'NOPE', 'SANTANDER_SORPRESA', 'GALICIA_EMINENT']),
    ).toEqual(['SANTANDER_SORPRESA', 'GALICIA_EMINENT']);
  });
});

describe('promotionMatchesAudience', () => {
  it('shows open promos to everyone', () => {
    expect(promotionMatchesAudience([], [])).toBe(true);
    expect(promotionMatchesAudience([], ['SANTANDER_SORPRESA'])).toBe(true);
    expect(promotionMatchesAudience(null, null)).toBe(true);
  });

  it('hides exclusive promos without the program', () => {
    expect(promotionMatchesAudience(['SANTANDER_SORPRESA'], [])).toBe(false);
    expect(promotionMatchesAudience(['SANTANDER_SORPRESA'], ['GALICIA_EMINENT'])).toBe(false);
  });

  it('shows exclusive promos when household has a matching program', () => {
    expect(promotionMatchesAudience(['SANTANDER_SORPRESA'], ['SANTANDER_SORPRESA'])).toBe(true);
    expect(
      promotionMatchesAudience(['SANTANDER_SELECT', 'SANTANDER_SORPRESA'], ['SANTANDER_SELECT']),
    ).toBe(true);
  });
});
