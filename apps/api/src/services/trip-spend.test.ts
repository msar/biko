import { describe, expect, it } from 'vitest';
import { buildCategorySpendBreakdown } from './trip.js';

describe('buildCategorySpendBreakdown', () => {
  const members = [
    { id: 'ana', displayName: 'Ana', tripHouseholdId: 'h1' },
    { id: 'bob', displayName: 'Bob', tripHouseholdId: 'h1' },
    { id: 'carlos', displayName: 'Carlos', tripHouseholdId: null },
  ];
  const households = [{ id: 'h1', name: 'Los García' }];

  it('splits spend by member and rolls up groups from allocations', () => {
    const result = buildCategorySpendBreakdown({
      members,
      households,
      expenses: [
        {
          category: 'COMIDA',
          amount: 100,
          allocations: [
            { tripMemberId: 'ana', amount: 50 },
            { tripMemberId: 'bob', amount: 50 },
          ],
        },
        {
          category: 'VUELOS',
          amount: 80,
          allocations: [{ tripMemberId: 'carlos', amount: 80 }],
        },
      ],
    });

    expect(result.totals.map((c) => c.category)).toEqual(['COMIDA', 'VUELOS']);
    expect(result.totals[0]).toMatchObject({ category: 'COMIDA', total: 100, percent: 55.56 });

    const ana = result.byMember.find((p) => p.id === 'ana');
    const bob = result.byMember.find((p) => p.id === 'bob');
    const carlos = result.byMember.find((p) => p.id === 'carlos');
    expect(ana).toMatchObject({ total: 50, kind: 'MEMBER' });
    expect(ana?.categories).toEqual([{ category: 'COMIDA', total: 50, percent: 100 }]);
    expect(bob?.total).toBe(50);
    expect(carlos?.categories).toEqual([{ category: 'VUELOS', total: 80, percent: 100 }]);

    const group = result.byUnit.find((u) => u.id === 'household:h1');
    const solo = result.byUnit.find((u) => u.id === 'member:carlos');
    expect(group).toMatchObject({
      kind: 'HOUSEHOLD',
      displayName: 'Los García',
      total: 100,
    });
    expect(group?.categories).toEqual([{ category: 'COMIDA', total: 100, percent: 100 }]);
    expect(solo).toMatchObject({ kind: 'MEMBER', displayName: 'Carlos', total: 80 });
  });

  it('keeps trip totals from expense amount even when allocations differ', () => {
    const result = buildCategorySpendBreakdown({
      members: [{ id: 'ana', displayName: 'Ana', tripHouseholdId: null }],
      households: [],
      expenses: [
        {
          category: 'OTROS',
          amount: 10,
          allocations: [{ tripMemberId: 'ana', amount: 9.99 }],
        },
      ],
    });
    expect(result.totals).toEqual([{ category: 'OTROS', total: 10, percent: 100 }]);
    expect(result.byMember[0]?.total).toBe(9.99);
  });
});
