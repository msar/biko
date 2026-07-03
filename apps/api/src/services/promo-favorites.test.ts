import { describe, expect, it } from 'vitest';
import { favoriteGroupFromPromotion } from './promo-favorites.js';

describe('favoriteGroupFromPromotion', () => {
  it('maps promotion to weekly group key and label', () => {
    const result = favoriteGroupFromPromotion({
      store: 'ChangoMás',
      notes: '20% en ChangoMás',
      sponsorBank: 'Santander',
      entity: { name: 'MODO' },
    });
    expect(result.groupKey).toBe('changomás');
    expect(result.label).toBe('ChangoMás');
  });
});
