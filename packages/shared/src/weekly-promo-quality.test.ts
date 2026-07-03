import { describe, expect, it } from 'vitest';
import { isActionableWeeklyPromo, parseMinPurchaseAmount, weeklyPromoGroupKey, weeklyPromoGroupLabel, filterHiddenWeeklyGroups, sortWeeklyGroupsByFavorites } from './weekly-promo-quality';

describe('isActionableWeeklyPromo', () => {
  it('excludes auto insurance miscategorized as combustible', () => {
    expect(
      isActionableWeeklyPromo({
        store: 'Venta Seguro de Autos',
        notes: '90%Ventas seguro de auto',
        categoryNames: ['Combustible'],
        details: [],
      }),
    ).toBe(false);
  });

  it('keeps named supermarkets with MODO link', () => {
    expect(
      isActionableWeeklyPromo({
        store: 'ChangoMás',
        notes: '20% en ChangoMás',
        categoryNames: ['Supermercado'],
        details: [],
        sourceUrl: 'https://www.modo.com.ar/promos/changomas-julio26',
      }),
    ).toBe(true);
  });

  it('excludes promos without sourceUrl', () => {
    expect(
      isActionableWeeklyPromo({
        store: 'ChangoMás',
        notes: '20% en ChangoMás',
        categoryNames: ['Supermercado'],
        details: [],
        sourceUrl: null,
      }),
    ).toBe(false);
  });

  it('keeps supermercados que acepten MODO', () => {
    expect(
      isActionableWeeklyPromo({
        store: 'Supermercados que acepten MODO',
        notes: '5% Supermercados',
        categoryNames: ['Supermercado'],
        details: [],
        sourceUrl: 'https://www.modo.com.ar/promos/super-modo',
      }),
    ).toBe(true);
  });

  it('excludes generic comercios adheridos', () => {
    expect(
      isActionableWeeklyPromo({
        store: 'Comercios adheridos',
        notes: '70% promo',
        categoryNames: ['Supermercado'],
        details: [],
      }),
    ).toBe(false);
  });

  it('groups axion promos under same key', () => {
    const key = weeklyPromoGroupKey({ store: 'Axion', notes: '20% en Axion', entityName: 'MODO' });
    expect(key).toBe('axion');
  });
});

describe('weeklyPromoGroupLabel', () => {
  it('prefers store name when actionable', () => {
    expect(weeklyPromoGroupLabel({ store: 'ChangoMás', notes: '20%' })).toBe('ChangoMás');
  });
});

describe('filterHiddenWeeklyGroups', () => {
  it('removes promos matching hidden group keys across days', () => {
    const days = [
      {
        dayOfWeek: 'MONDAY',
        promotions: [
          { store: 'ChangoMás', notes: '20%', entityName: 'Santander' },
          { store: 'YPF', notes: '10%', entityName: 'BBVA' },
        ],
      },
      {
        dayOfWeek: 'THURSDAY',
        promotions: [{ store: 'ChangoMás', notes: '30%', entityName: 'ICBC' }],
      },
    ];
    const filtered = filterHiddenWeeklyGroups(days, new Set(['changomás']));
    expect(filtered[0]!.promotions).toHaveLength(1);
    expect(filtered[0]!.promotions[0]!.store).toBe('YPF');
    expect(filtered[1]!.promotions).toHaveLength(0);
  });
});

describe('parseMinPurchaseAmount', () => {
  it('extracts minimum from MODO copy', () => {
    expect(parseMinPurchaseAmount(['Compra mínima $75.000 en ticket'])).toBe(75000);
    expect(parseMinPurchaseAmount(['Mínimo de consumo 50000'])).toBe(50000);
  });
});

describe('sortWeeklyGroupsByFavorites', () => {
  it('puts favorited groups first while preserving order within tiers', () => {
    const groups = [
      { key: 'a', label: 'A' },
      { key: 'b', label: 'B' },
      { key: 'c', label: 'C' },
      { key: 'd', label: 'D' },
    ];
    const sorted = sortWeeklyGroupsByFavorites(groups, new Set(['c', 'a']));
    expect(sorted.map((g) => g.key)).toEqual(['a', 'c', 'b', 'd']);
  });

  it('returns original order when no favorites', () => {
    const groups = [{ key: 'x' }, { key: 'y' }];
    expect(sortWeeklyGroupsByFavorites(groups, [])).toEqual(groups);
  });
});
