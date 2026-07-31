import { describe, expect, it } from 'vitest';
import {
  applySettlementOffsets,
  computePartyEqualSplit,
  computeSettleTransfers,
} from './settle-up';

describe('computePartyEqualSplit', () => {
  it('returns zeros with fewer than two people', () => {
    expect(computePartyEqualSplit([{ id: 'a', paid: 100 }])).toEqual({
      total: 0,
      share: 0,
      balances: [{ userId: 'a', balance: 0 }],
    });
    expect(computePartyEqualSplit([])).toEqual({ total: 0, share: 0, balances: [] });
  });

  it('splits two people evenly when one paid all', () => {
    const result = computePartyEqualSplit([
      { id: 'a', paid: 10000 },
      { id: 'b', paid: 0 },
    ]);
    expect(result.total).toBe(10000);
    expect(result.share).toBe(5000);
    expect(result.balances).toEqual([
      { userId: 'a', balance: 5000 },
      { userId: 'b', balance: -5000 },
    ]);
    expect(computeSettleTransfers(result.balances)).toEqual([
      { fromUserId: 'b', toUserId: 'a', amount: 5000 },
    ]);
  });

  it('nets three people who paid unevenly', () => {
    const result = computePartyEqualSplit([
      { id: 'a', paid: 9000 },
      { id: 'b', paid: 3000 },
      { id: 'c', paid: 0 },
    ]);
    expect(result.total).toBe(12000);
    expect(result.share).toBe(4000);
    expect(result.balances).toEqual([
      { userId: 'a', balance: 5000 },
      { userId: 'b', balance: -1000 },
      { userId: 'c', balance: -4000 },
    ]);
    expect(computeSettleTransfers(result.balances)).toEqual([
      { fromUserId: 'c', toUserId: 'a', amount: 4000 },
      { fromUserId: 'b', toUserId: 'a', amount: 1000 },
    ]);
  });

  it('returns even balances when everyone paid their share', () => {
    const result = computePartyEqualSplit([
      { id: 'a', paid: 2000 },
      { id: 'b', paid: 2000 },
      { id: 'c', paid: 2000 },
    ]);
    expect(result.total).toBe(6000);
    expect(result.share).toBe(2000);
    expect(result.balances.every((b) => b.balance === 0)).toBe(true);
    expect(computeSettleTransfers(result.balances)).toEqual([]);
  });
});

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
