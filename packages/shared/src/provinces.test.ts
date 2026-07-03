import { describe, expect, it } from 'vitest';
import { inferPromotionProvinces, promotionMatchesProvince } from './provinces';

describe('inferPromotionProvinces', () => {
  it('detects Salta from promo copy', () => {
    expect(
      inferPromotionProvinces({ title: '30% en Gastronomía Salta', tags: 'gastronomia,salta' }),
    ).toEqual(['Salta']);
  });

  it('treats national chains as nationwide', () => {
    expect(inferPromotionProvinces({ title: '20% en ChangoMás', store: 'ChangoMas' })).toEqual([]);
  });
});

describe('promotionMatchesProvince', () => {
  it('shows nationwide promos everywhere', () => {
    expect(promotionMatchesProvince([], 'Córdoba')).toBe(true);
  });

  it('hides regional promos outside their province', () => {
    expect(promotionMatchesProvince(['Salta'], 'Córdoba')).toBe(false);
    expect(promotionMatchesProvince(['Salta'], 'Salta')).toBe(true);
  });
});
