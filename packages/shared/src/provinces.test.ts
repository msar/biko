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

  it('maps Alvear supermercados to Santa Fe', () => {
    expect(
      inferPromotionProvinces({
        title: '25% en Supermercados Alvear',
        store: 'Supermercados Alvear',
        tags: 'supermercado alvear,reintegro,presencial',
      }),
    ).toEqual(['Santa Fe']);
  });

  it('maps UADE / La Cantina to CABA', () => {
    expect(
      inferPromotionProvinces({
        title: '20% en La Cantina',
        where: 'La Cantina, Kiokos y Comedores UADE',
        tags: 'uade,santander,comedor,la cantina',
        shortDescription: '2607-Santander-LaCantinaUADE-Presencial-20off',
      }),
    ).toEqual(['Ciudad Autónoma de Buenos Aires']);
  });

  it('uses details text for city hints', () => {
    expect(
      inferPromotionProvinces({
        title: '15% en local',
        details: ['Válido en Rosario'],
      }),
    ).toEqual(['Santa Fe']);
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
