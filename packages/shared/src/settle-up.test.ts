import { describe, expect, it } from 'vitest';
import { computeSettleTransfers } from './settle-up';

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
