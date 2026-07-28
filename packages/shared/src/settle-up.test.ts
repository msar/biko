import { describe, expect, it } from 'vitest';
import { applySettlementOffsets, computeSettleTransfers } from './settle-up';

describe('computeSettleTransfers', () => {
  it('settles a two-person owe case', () => {
    const result = computeSettleTransfers([
      { userId: 'u1', balance: 5000 },
      { userId: 'u2', balance: -5000 },
    ]);
    expect(result).toEqual([{ fromUserId: 'u2', toUserId: 'u1', amount: 5000 }]);
  });

  it('returns nothing when everyone is even', () => {
    const result = computeSettleTransfers([
      { userId: 'u1', balance: 0 },
      { userId: 'u2', balance: 0 },
    ]);
    expect(result).toEqual([]);
  });

  it('nets three people minimally', () => {
    const result = computeSettleTransfers([
      { userId: 'u1', balance: 6000 },
      { userId: 'u2', balance: -4000 },
      { userId: 'u3', balance: -2000 },
    ]);
    expect(result).toEqual([
      { fromUserId: 'u2', toUserId: 'u1', amount: 4000 },
      { fromUserId: 'u3', toUserId: 'u1', amount: 2000 },
    ]);
  });

  it('ignores sub-cent residues', () => {
    const result = computeSettleTransfers([
      { userId: 'u1', balance: 0.004 },
      { userId: 'u2', balance: -0.004 },
    ]);
    expect(result).toEqual([]);
  });
});

describe('applySettlementOffsets', () => {
  it('zeros a two-person debt when fully settled', () => {
    const expense = [
      { userId: 'u1', balance: 5000 },
      { userId: 'u2', balance: -5000 },
    ];
    const adjusted = applySettlementOffsets(expense, [
      { fromUserId: 'u2', toUserId: 'u1', amount: 5000 },
    ]);
    expect(adjusted).toEqual([
      { userId: 'u1', balance: 0 },
      { userId: 'u2', balance: 0 },
    ]);
    expect(computeSettleTransfers(adjusted)).toEqual([]);
  });

  it('supports partial settlement', () => {
    const expense = [
      { userId: 'u1', balance: 5000 },
      { userId: 'u2', balance: -5000 },
    ];
    const adjusted = applySettlementOffsets(expense, [
      { fromUserId: 'u2', toUserId: 'u1', amount: 2000 },
    ]);
    expect(adjusted).toEqual([
      { userId: 'u1', balance: 3000 },
      { userId: 'u2', balance: -3000 },
    ]);
    expect(computeSettleTransfers(adjusted)).toEqual([
      { fromUserId: 'u2', toUserId: 'u1', amount: 3000 },
    ]);
  });

  it('stacks multiple settlements', () => {
    const expense = [
      { userId: 'u1', balance: 6000 },
      { userId: 'u2', balance: -4000 },
      { userId: 'u3', balance: -2000 },
    ];
    const adjusted = applySettlementOffsets(expense, [
      { fromUserId: 'u2', toUserId: 'u1', amount: 4000 },
      { fromUserId: 'u3', toUserId: 'u1', amount: 1000 },
    ]);
    expect(adjusted).toEqual([
      { userId: 'u1', balance: 1000 },
      { userId: 'u2', balance: 0 },
      { userId: 'u3', balance: -1000 },
    ]);
    expect(computeSettleTransfers(adjusted)).toEqual([
      { fromUserId: 'u3', toUserId: 'u1', amount: 1000 },
    ]);
  });
});
