import { describe, expect, it } from 'vitest';
import { planTripHouseholdExport, scalePaidToShare } from './trip-export-plan.js';

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

function paymentMap(spec: { payments: Array<{ userId: string; amount: number }> }) {
  return Object.fromEntries(spec.payments.map((p) => [p.userId, p.amount]));
}

describe('scalePaidToShare', () => {
  it('scales payments to share total preserving proportions', () => {
    const paid = new Map([
      [ana, 400],
      [bob, 100],
    ]);
    const scaled = scalePaidToShare(paid, [ana, bob], 250);
    expect(scaled.get(ana)).toBe(200);
    expect(scaled.get(bob)).toBe(50);
  });
});

describe('planTripHouseholdExport', () => {
  it('one payer: one Viaje purchase with AMOUNT shares and matching payment', () => {
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
    expect(plan.purchases).toHaveLength(1);
    expect(plan.purchases[0]).toMatchObject({
      seedCategoryName: 'Viajes',
      amount: 100,
      paidByUserId: ana,
      coveredByOthers: false,
    });
    expect(splitMap(plan.purchases[0]!)).toEqual({ [ana]: 50, [bob]: 50 });
    expect(paymentMap(plan.purchases[0]!)).toEqual({ [ana]: 100 });
    expect(plan.members).toEqual([
      { userId: ana, name: 'Ana', paid: 100, share: 50 },
      { userId: bob, name: 'Bob', paid: 0, share: 50 },
    ]);
  });

  it('both paid: one purchase; payments scaled globally so paid total equals share', () => {
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
            { tripMemberId: 'm-ana', amount: 50 },
            { tripMemberId: 'm-bob', amount: 50 },
          ],
        },
      ],
    });

    expect(plan.purchases).toHaveLength(1);
    const p = plan.purchases[0]!;
    expect(p.amount).toBe(100);
    expect(paymentMap(p)).toEqual({ [ana]: 70, [bob]: 30 });
    const paySum = p.payments.reduce((s, x) => s + x.amount, 0);
    expect(paySum).toBe(100);
    expect(plan.members.find((m) => m.userId === ana)).toMatchObject({ paid: 70, share: 50 });
    expect(plan.members.find((m) => m.userId === bob)).toMatchObject({ paid: 30, share: 50 });
  });

  it('covered-by-others category does not leave aggregate paid < share', () => {
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
          payments: [],
          allocations: [
            { tripMemberId: 'm-ana', amount: 105 },
            { tripMemberId: 'm-bob', amount: 105 },
          ],
        },
        {
          category: 'COMIDA',
          payments: [
            { tripMemberId: 'm-ana', amount: 400 },
            { tripMemberId: 'm-bob', amount: 100 },
          ],
          allocations: [
            { tripMemberId: 'm-ana', amount: 50 },
            { tripMemberId: 'm-bob', amount: 50 },
          ],
        },
      ],
    });

    expect(plan.netShare).toBe(310);
    expect(plan.purchases).toHaveLength(1);
    const p = plan.purchases[0]!;
    const paySum = p.payments.reduce((s, x) => s + x.amount, 0);
    const shareSum = p.splitValues.reduce((s, x) => s + x.value, 0);
    expect(Math.abs(paySum - plan.netShare)).toBeLessThan(0.015);
    expect(Math.abs(shareSum - plan.netShare)).toBeLessThan(0.015);
    // Ana paid more on the trip → still pays more after scaling
    const anaPay = p.payments.find((x) => x.userId === ana)!.amount;
    const bobPay = p.payments.find((x) => x.userId === bob)!.amount;
    expect(anaPay).toBeGreaterThan(bobPay);
    expect(plan.members.reduce((s, m) => s + m.paid, 0)).toBeCloseTo(plan.netShare, 1);
  });

  it('nobody in hogar paid: exporter is sole payer, coveredByOthers', () => {
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
          category: 'ACTIVIDADES',
          payments: [],
          allocations: [
            { tripMemberId: 'm-ana', amount: 40 },
            { tripMemberId: 'm-bob', amount: 40 },
          ],
        },
      ],
    });

    expect(plan.purchases).toHaveLength(1);
    expect(plan.purchases[0]!.coveredByOthers).toBe(true);
    expect(plan.purchases[0]!.paidByUserId).toBe(ana);
    expect(paymentMap(plan.purchases[0]!)).toEqual({ [ana]: 80 });
  });

  it('includes $0 split for hogar members not on the trip', () => {
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
          category: 'COMIDA',
          payments: [{ tripMemberId: 'm-ana', amount: 90 }],
          allocations: [
            { tripMemberId: 'm-ana', amount: 45 },
            { tripMemberId: 'm-bob', amount: 45 },
          ],
        },
      ],
    });

    expect(plan.purchases[0]!.amount).toBe(90);
    expect(splitMap(plan.purchases[0]!)).toEqual({ [ana]: 45, [bob]: 45, [cara]: 0 });
  });

  it('keeps split and payment values non-negative and summing to amount', () => {
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
          category: 'COMIDA',
          payments: [
            { tripMemberId: 'm-ana', amount: 70.01 },
            { tripMemberId: 'm-bob', amount: 29.99 },
          ],
          allocations: [
            { tripMemberId: 'm-ana', amount: 40.33 },
            { tripMemberId: 'm-bob', amount: 59.67 },
          ],
        },
      ],
    });

    expect(plan.purchases).toHaveLength(1);
    const p = plan.purchases[0]!;
    const shareSum = p.splitValues.reduce((s, v) => s + v.value, 0);
    const paySum = p.payments.reduce((s, v) => s + v.amount, 0);
    expect(Math.abs(shareSum - p.amount)).toBeLessThan(0.015);
    expect(Math.abs(paySum - p.amount)).toBeLessThan(0.015);
    for (const v of p.splitValues) expect(v.value).toBeGreaterThanOrEqual(0);
    for (const v of p.payments) expect(v.amount).toBeGreaterThanOrEqual(0);
  });
});
