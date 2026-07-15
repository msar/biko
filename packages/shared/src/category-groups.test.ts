import { describe, expect, it } from 'vitest';
import {
  groupCategories,
  groupCategoriesByMonth,
  resolveCategoryGroupId,
} from './category-groups';

describe('resolveCategoryGroupId', () => {
  it('maps groceries to Comida', () => {
    expect(resolveCategoryGroupId('Supermercado')).toBe('comida');
    expect(resolveCategoryGroupId('Verdulería')).toBe('comida');
    expect(resolveCategoryGroupId('Carnicería')).toBe('comida');
    expect(resolveCategoryGroupId('Pollería')).toBe('comida');
  });

  it('falls unknown names into otros', () => {
    expect(resolveCategoryGroupId('Mascotas')).toBe('otros');
  });
});

describe('groupCategories', () => {
  it('rolls categories into groups and sorts by total', () => {
    const result = groupCategories([
      { categoryId: '1', name: 'Supermercado', icon: '🛒', color: '#4f8a5b', total: 10000 },
      { categoryId: '2', name: 'Verdulería', icon: '🥬', color: '#5c9e4f', total: 5000 },
      { categoryId: '3', name: 'Combustible', icon: '⛽', color: '#8a6b4f', total: 8000 },
      { categoryId: '4', name: 'Mascotas', icon: '🐕', color: '#999', total: 2000 },
    ]);

    expect(result.map((g) => g.id)).toEqual(['comida', 'transporte', 'otros']);
    expect(result[0]!.total).toBe(15000);
    expect(result[0]!.categories).toHaveLength(2);
    expect(result[2]!.categories[0]!.name).toBe('Mascotas');
  });

  it('omits empty groups', () => {
    const result = groupCategories([
      { categoryId: '1', name: 'Farmacia', icon: null, color: null, total: 100 },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('salud');
  });
});

describe('groupCategoriesByMonth', () => {
  it('sums byMonth across categories in a group', () => {
    const months = ['2026-01', '2026-02'];
    const result = groupCategoriesByMonth(
      [
        {
          categoryId: '1',
          name: 'Supermercado',
          icon: null,
          color: null,
          total: 300,
          byMonth: [
            { month: '2026-01', total: 100 },
            { month: '2026-02', total: 200 },
          ],
        },
        {
          categoryId: '2',
          name: 'Panadería',
          icon: null,
          color: null,
          total: 50,
          byMonth: [
            { month: '2026-01', total: 50 },
            { month: '2026-02', total: 0 },
          ],
        },
      ],
      months,
    );

    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('comida');
    expect(result[0]!.total).toBe(350);
    expect(result[0]!.byMonth).toEqual([
      { month: '2026-01', total: 150 },
      { month: '2026-02', total: 200 },
    ]);
  });
});
