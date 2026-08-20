import { describe, expect, it } from 'vitest';
import { primaryPayerUserId, splitPaidAcrossPayers } from './purchase-payer.js';

describe('primaryPayerUserId', () => {
  it('picks largest payment with stable tie-break', () => {
    expect(
      primaryPayerUserId([
        { userId: 'b', amount: 50 },
        { userId: 'a', amount: 50 },
      ]),
    ).toBe('a');
    expect(
      primaryPayerUserId([
        { userId: 'b', amount: 60 },
        { userId: 'a', amount: 40 },
      ]),
    ).toBe('b');
  });
});

describe('splitPaidAcrossPayers', () => {
  it('splits installment proportionally across payers', () => {
    const slices = splitPaidAcrossPayers(
      100,
      [
        { userId: 'ana', amount: 70 },
        { userId: 'bob', amount: 30 },
      ],
      'ana',
      100,
    );
    expect(slices).toEqual([
      { userId: 'ana', amount: 70 },
      { userId: 'bob', amount: 30 },
    ]);
  });

  it('falls back to single payer when payments empty', () => {
    expect(splitPaidAcrossPayers(80, [], 'ana', 80)).toEqual([{ userId: 'ana', amount: 80 }]);
  });

  it('scales installment slice when purchase has multiple installments', () => {
    const slices = splitPaidAcrossPayers(
      50,
      [
        { userId: 'ana', amount: 70 },
        { userId: 'bob', amount: 30 },
      ],
      'ana',
      100,
    );
    expect(slices.find((s) => s.userId === 'ana')!.amount).toBe(35);
    expect(slices.find((s) => s.userId === 'bob')!.amount).toBe(15);
  });
});
