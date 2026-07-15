export interface CategoryGroupDef {
  id: string;
  name: string;
  icon: string;
  color: string;
  /** Exact category names (global seed) that belong to this group. */
  categoryNames: string[];
}

export interface CategorySpendRow {
  categoryId: string;
  name: string;
  icon: string | null;
  color: string | null;
  total: number;
}

export interface GroupedCategorySpend extends CategoryGroupDef {
  total: number;
  categories: CategorySpendRow[];
}

export interface CategorySpendByMonthRow extends CategorySpendRow {
  byMonth: Array<{ month: string; total: number }>;
}

export interface GroupedCategorySpendByMonth extends CategoryGroupDef {
  total: number;
  byMonth: Array<{ month: string; total: number }>;
  categories: CategorySpendByMonthRow[];
}

/** Product-default groups matched by category name. Unmatched → Otros. */
export const CATEGORY_GROUPS: CategoryGroupDef[] = [
  {
    id: 'comida',
    name: 'Comida',
    icon: '🥗',
    color: '#4f8a5b',
    categoryNames: ['Supermercado', 'Verdulería', 'Carnicería', 'Pollería', 'Panadería', 'Restaurante'],
  },
  {
    id: 'salud',
    name: 'Salud',
    icon: '💊',
    color: '#4a7fb5',
    categoryNames: ['Farmacia', 'Salud'],
  },
  {
    id: 'transporte',
    name: 'Transporte',
    icon: '🚌',
    color: '#5b8a9e',
    categoryNames: ['Transporte', 'Combustible'],
  },
  {
    id: 'vivienda',
    name: 'Vivienda',
    icon: '🏠',
    color: '#8a7f5b',
    categoryNames: ['Servicios', 'Hogar'],
  },
  {
    id: 'indumentaria',
    name: 'Indumentaria',
    icon: '👕',
    color: '#6b8ab5',
    categoryNames: ['Indumentaria'],
  },
  {
    id: 'otros',
    name: 'Otros',
    icon: '📦',
    color: '#888888',
    categoryNames: ['Otros'],
  },
];

const nameToGroupId = new Map<string, string>();
for (const group of CATEGORY_GROUPS) {
  for (const name of group.categoryNames) {
    nameToGroupId.set(name, group.id);
  }
}

export function resolveCategoryGroupId(categoryName: string): string {
  return nameToGroupId.get(categoryName) ?? 'otros';
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Roll flat category spend into product groups. Categories with unknown names
 * land in Otros. Empty groups are omitted. Sorted by total desc.
 */
export function groupCategories(rows: CategorySpendRow[]): GroupedCategorySpend[] {
  const byGroup = new Map<string, GroupedCategorySpend>();

  for (const def of CATEGORY_GROUPS) {
    byGroup.set(def.id, {
      ...def,
      total: 0,
      categories: [],
    });
  }

  for (const row of rows) {
    if (row.total <= 0) continue;
    const groupId = resolveCategoryGroupId(row.name);
    const group = byGroup.get(groupId)!;
    group.total = round2(group.total + row.total);
    group.categories.push({ ...row, total: round2(row.total) });
  }

  return [...byGroup.values()]
    .filter((g) => g.total > 0)
    .map((g) => ({
      ...g,
      categories: g.categories.sort((a, b) => b.total - a.total),
    }))
    .sort((a, b) => b.total - a.total);
}

/**
 * Same as groupCategories but also sums byMonth series (aligned to provided months).
 */
export function groupCategoriesByMonth(
  rows: CategorySpendByMonthRow[],
  months: string[],
): GroupedCategorySpendByMonth[] {
  const byGroup = new Map<string, GroupedCategorySpendByMonth>();

  for (const def of CATEGORY_GROUPS) {
    byGroup.set(def.id, {
      ...def,
      total: 0,
      byMonth: months.map((month) => ({ month, total: 0 })),
      categories: [],
    });
  }

  for (const row of rows) {
    if (row.total <= 0) continue;
    const groupId = resolveCategoryGroupId(row.name);
    const group = byGroup.get(groupId)!;
    group.total = round2(group.total + row.total);
    for (const point of row.byMonth) {
      const idx = months.indexOf(point.month);
      if (idx < 0) continue;
      const entry = group.byMonth[idx]!;
      entry.total = round2(entry.total + point.total);
    }
    group.categories.push({
      ...row,
      total: round2(row.total),
      byMonth: row.byMonth.map((p) => ({ month: p.month, total: round2(p.total) })),
    });
  }

  return [...byGroup.values()]
    .filter((g) => g.total > 0)
    .map((g) => ({
      ...g,
      categories: g.categories.sort((a, b) => b.total - a.total),
    }))
    .sort((a, b) => b.total - a.total);
}
