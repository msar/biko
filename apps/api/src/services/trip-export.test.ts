import { describe, expect, it } from 'vitest';
import { planTripHouseholdExport } from './trip-export-plan.js';

const ana = 'user-ana';
const bob = 'user-bob';
const cara = 'user-cara';

function names() {
  return new Map([
    [ana, 'Ana'],
    [bob, 'Bob'],
    [cara, 'Cara'],
  ]);
}

function splitMap(spec: { splitValues: Array<{ userId: string; value: number }> }) {
  return Object.fromEntries(spec.splitValues.map((s) => [s.userId, s.value]));
}

describe('planTripHouseholdExport', () => {
  it('one payer: one purchase with AMOUNT shares, paidBy that member', () => {
    const plan = planTripHouseholdExport({
      exporterUserId: ana,
      householdUserIds: [ana, bob],
      householdUserNames: names(),
      tripMemberToUserId: new Map([
        ['m-ana', ana],
        ['m-bob', bob],
      ]),
      expenses: [
        {
          category: 'ALOJAMIENTO',
          payments: [{ tripMemberId: 'm-ana', amount: 100 }],
          allocations: [
            { tripMemberId: 'm-ana', amount: 50 },
            { tripMemberId: 'm-bob', amount: 50 },
          ],
        },
      ],
    });

    expect(plan.netShare).toBe(100);
    expect(plan.categoryMix).toHaveLength(1);
    expect(plan.categoryMix[0]).toMatchObject({
      category: 'ALOJAMIENTO',
      amount: 100,
      percent: 100,
      purchasesCount: 1,
      coveredByOthers: false,
    });
    expect(plan.categoryMix[0]!.members).toEqual([
      { userId: ana, name: 'Ana', paid: 100, share: 50 },
      { userId: bob, name: 'Bob', paid: 0, share: 50 },
    ]);
    expect(plan.purchases).toHaveLength(1);
    expect(plan.purchases[0]).toMatchObject({
      category: 'ALOJAMIENTO',
      amount: 100,
      paidByUserId: ana,
      index: 0,
    });
    expect(splitMap(plan.purchases[0]!)).toEqual({ [ana]: 50, [bob]: 50 });
  });

  it('both paid: one purchase per payer; paid and share totals match', () => {
    const plan = planTripHouseholdExport({
      exporterUserId: ana,
      householdUserIds: [ana, bob],
      householdUserNames: names(),
      tripMemberToUserId: new Map([
        ['m-ana', ana],
        ['m-bob', bob],
      ]),
      expenses: [
        {
          category: 'COMIDA',
          payments: [
            { tripMemberId: 'm-ana', amount: 70 },
            { tripMemberId: 'm-bob', amount: 30 },
          ],
          allocations: [
            { tripMemberId: 'm-ana', amount: 40 },
            { tripMemberId: 'm-bob', amount: 60 },
          ],
        },
      ],
    });

    expect(plan.purchases).toHaveLength(2);
    expect(plan.categoryMix[0]!.purchasesCount).toBe(2);
    const paid: Record<string, number> = { [ana]: 0, [bob]: 0 };
    const share: Record<string, number> = { [ana]: 0, [bob]: 0 };
    for (const p of plan.purchases) {
      paid[p.paidByUserId] = (paid[p.paidByUserId] ?? 0) + p.amount;
      for (const s of p.splitValues) {
        share[s.userId] = (share[s.userId] ?? 0) + s.value;
      }
    }
    expect(paid[ana]).toBe(70);
    expect(paid[bob]).toBe(30);
    expect(share[ana]).toBe(40);
    expect(share[bob]).toBe(60);
    expect(plan.categoryMix[0]!.members).toEqual([
      { userId: ana, name: 'Ana', paid: 70, share: 40 },
      { userId: bob, name: 'Bob', paid: 30, share: 60 },
    ]);
  });

  it('member not on the trip gets $0 share', () => {
    const plan = planTripHouseholdExport({
      exporterUserId: ana,
      householdUserIds: [ana, bob, cara],
      householdUserNames: names(),
      tripMemberToUserId: new Map([
        ['m-ana', ana],
        ['m-bob', bob],
      ]),
      expenses: [
        {
          category: 'VUELOS',
          payments: [{ tripMemberId: 'm-ana', amount: 80 }],
          allocations: [
            { tripMemberId: 'm-ana', amount: 40 },
            { tripMemberId: 'm-bob', amount: 40 },
          ],
        },
      ],
    });

    expect(splitMap(plan.purchases[0]!)).toEqual({ [ana]: 40, [bob]: 40, [cara]: 0 });
    expect(plan.categoryMix[0]!.members.find((m) => m.userId === cara)).toBeUndefined();
  });

  it('category mix follows hogar allocations, not trip-wide %', () => {
    const plan = planTripHouseholdExport({
      exporterUserId: ana,
      householdUserIds: [ana, bob],
      householdUserNames: names(),
      tripMemberToUserId: new Map([
        ['m-ana', ana],
        ['m-bob', bob],
      ]),
      expenses: [
        {
          category: 'ALOJAMIENTO',
          payments: [{ tripMemberId: 'm-friend', amount: 200 }],
          allocations: [
            { tripMemberId: 'm-friend', amount: 200 },
          ],
        },
        {
          category: 'COMIDA',
          payments: [{ tripMemberId: 'm-ana', amount: 40 }],
          allocations: [
            { tripMemberId: 'm-ana', amount: 20 },
            { tripMemberId: 'm-bob', amount: 20 },
          ],
        },
      ],
    });

    expect(plan.netShare).toBe(40);
    expect(plan.categoryMix.map((c) => c.category)).toEqual(['COMIDA']);
    expect(plan.categoryMix[0]).toMatchObject({ amount: 40, percent: 100 });
  });

  it('scales hogar payments so they sum to hogar share', () => {
    const plan = planTripHouseholdExport({
      exporterUserId: ana,
      householdUserIds: [ana, bob],
      householdUserNames: names(),
      tripMemberToUserId: new Map([
        ['m-ana', ana],
        ['m-bob', bob],
      ]),
      expenses: [
        {
          category: 'RESTAURANTES',
          payments: [
            { tripMemberId: 'm-ana', amount: 150 },
            { tripMemberId: 'm-bob', amount: 50 },
          ],
          allocations: [
            { tripMemberId: 'm-ana', amount: 40 },
            { tripMemberId: 'm-bob', amount: 60 },
          ],
        },
      ],
    });

    const members = plan.categoryMix[0]!.members;
    const paidSum = members.reduce((s, m) => s + m.paid, 0);
    const shareSum = members.reduce((s, m) => s + m.share, 0);
    expect(paidSum).toBe(100);
    expect(shareSum).toBe(100);
    expect(members.find((m) => m.userId === ana)?.paid).toBe(75);
    expect(members.find((m) => m.userId === bob)?.paid).toBe(25);

    const purchasePaid: Record<string, number> = { [ana]: 0, [bob]: 0 };
    for (const p of plan.purchases) {
      purchasePaid[p.paidByUserId] = (purchasePaid[p.paidByUserId] ?? 0) + p.amount;
    }
    expect(purchasePaid[ana]).toBe(75);
    expect(purchasePaid[bob]).toBe(25);
  });

  it('when nobody in the hogar paid, exporter is payer and coveredByOthers is true', () => {
    const plan = planTripHouseholdExport({
      exporterUserId: bob,
      householdUserIds: [ana, bob],
      householdUserNames: names(),
      tripMemberToUserId: new Map([
        ['m-ana', ana],
        ['m-bob', bob],
      ]),
      expenses: [
        {
          category: 'ACTIVIDADES',
          payments: [{ tripMemberId: 'm-friend', amount: 90 }],
          allocations: [
            { tripMemberId: 'm-ana', amount: 45 },
            { tripMemberId: 'm-bob', amount: 45 },
          ],
        },
      ],
    });

    expect(plan.categoryMix[0]!.coveredByOthers).toBe(true);
    expect(plan.purchases).toHaveLength(1);
    expect(plan.purchases[0]!.paidByUserId).toBe(bob);
    expect(plan.purchases[0]!.amount).toBe(90);
  });
});
