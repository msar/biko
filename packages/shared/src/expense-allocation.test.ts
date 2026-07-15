import { describe, expect, it } from 'vitest';
import {
  allocationShareForInstallment,
  buildAmountAllocations,
  buildAssignedAllocations,
  buildCustomAllocations,
  buildDefaultAllocations,
  buildPercentageAllocations,
  buildPurchaseAllocations,
  buildShareAllocations,
} from './expense-allocation';

describe('buildDefaultAllocations', () => {
  it('splits equally between two members', () => {
    const result = buildDefaultAllocations(50000, ['u1', 'u2']);
    expect(result).toEqual([
      { userId: 'u1', amount: 25000 },
      { userId: 'u2', amount: 25000 },
    ]);
  });

  it('absorbs rounding drift on last member', () => {
    const result = buildDefaultAllocations(100, ['u1', 'u2', 'u3']);
    const sum = result.reduce((s, a) => s + a.amount, 0);
    expect(sum).toBe(100);
    expect(result[2]!.amount).toBe(33.34);
  });
});

describe('buildCustomAllocations', () => {
  it('assigns my share and remainder to partner', () => {
    const result = buildCustomAllocations(50000, 'u1', 15000, ['u1', 'u2']);
    expect(result).toEqual([
      { userId: 'u1', amount: 15000 },
      { userId: 'u2', amount: 35000 },
    ]);
  });

  it('rejects share greater than total', () => {
    expect(() => buildCustomAllocations(50000, 'u1', 60000, ['u1', 'u2'])).toThrow();
  });
});

describe('buildAssignedAllocations', () => {
  it('assigns 100% to one member and 0 to others', () => {
    const result = buildAssignedAllocations(50000, 'u2', ['u1', 'u2']);
    expect(result).toEqual([
      { userId: 'u1', amount: 0 },
      { userId: 'u2', amount: 50000 },
    ]);
  });

  it('rejects assignee outside household', () => {
    expect(() => buildAssignedAllocations(100, 'u3', ['u1', 'u2'])).toThrow();
  });
});

describe('buildAmountAllocations', () => {
  it('uses absolute amounts per member', () => {
    const result = buildAmountAllocations(
      50000,
      [
        { userId: 'u1', value: 10000 },
        { userId: 'u2', value: 40000 },
      ],
      ['u1', 'u2'],
    );
    expect(result).toEqual([
      { userId: 'u1', amount: 10000 },
      { userId: 'u2', amount: 40000 },
    ]);
  });

  it('rejects when amounts do not sum to net', () => {
    expect(() =>
      buildAmountAllocations(
        50000,
        [
          { userId: 'u1', value: 10000 },
          { userId: 'u2', value: 10000 },
        ],
        ['u1', 'u2'],
      ),
    ).toThrow();
  });
});

describe('buildShareAllocations', () => {
  it('splits by share weights 1:2', () => {
    const result = buildShareAllocations(
      30000,
      [
        { userId: 'u1', value: 1 },
        { userId: 'u2', value: 2 },
      ],
      ['u1', 'u2'],
    );
    expect(result).toEqual([
      { userId: 'u1', amount: 10000 },
      { userId: 'u2', amount: 20000 },
    ]);
  });

  it('absorbs rounding on last member', () => {
    const result = buildShareAllocations(
      100,
      [
        { userId: 'u1', value: 1 },
        { userId: 'u2', value: 1 },
        { userId: 'u3', value: 1 },
      ],
      ['u1', 'u2', 'u3'],
    );
    expect(result.reduce((s, a) => s + a.amount, 0)).toBe(100);
    expect(result[2]!.amount).toBe(33.34);
  });
});

describe('buildPercentageAllocations', () => {
  it('splits by percentage 30/70', () => {
    const result = buildPercentageAllocations(
      10000,
      [
        { userId: 'u1', value: 30 },
        { userId: 'u2', value: 70 },
      ],
      ['u1', 'u2'],
    );
    expect(result).toEqual([
      { userId: 'u1', amount: 3000 },
      { userId: 'u2', amount: 7000 },
    ]);
  });

  it('rejects percentages that do not sum to 100', () => {
    expect(() =>
      buildPercentageAllocations(
        10000,
        [
          { userId: 'u1', value: 40 },
          { userId: 'u2', value: 40 },
        ],
        ['u1', 'u2'],
      ),
    ).toThrow();
  });
});

describe('allocationShareForInstallment', () => {
  it('attributes proportional cuota share', () => {
    expect(allocationShareForInstallment(5000, 15000, 50000)).toBe(1500);
    expect(allocationShareForInstallment(5000, 35000, 50000)).toBe(3500);
  });
});

describe('buildPurchaseAllocations', () => {
  it('personal scope assigns 100% to user', () => {
    const result = buildPurchaseAllocations({
      scope: 'PERSONAL',
      netAmount: 8000,
      userId: 'u1',
      memberIds: ['u1', 'u2'],
    });
    expect(result).toEqual([{ userId: 'u1', amount: 8000 }]);
  });

  it('household with legacy myShareAmount', () => {
    const result = buildPurchaseAllocations({
      scope: 'HOUSEHOLD',
      netAmount: 50000,
      userId: 'u1',
      memberIds: ['u1', 'u2'],
      myShareAmount: 15000,
    });
    expect(result).toEqual([
      { userId: 'u1', amount: 15000 },
      { userId: 'u2', amount: 35000 },
    ]);
  });

  it('household ASSIGN to partner', () => {
    const result = buildPurchaseAllocations({
      scope: 'HOUSEHOLD',
      netAmount: 20000,
      userId: 'u1',
      memberIds: ['u1', 'u2'],
      splitMode: 'ASSIGN',
      assignToUserId: 'u2',
    });
    expect(result).toEqual([
      { userId: 'u1', amount: 0 },
      { userId: 'u2', amount: 20000 },
    ]);
  });

  it('household PERCENTAGE mode', () => {
    const result = buildPurchaseAllocations({
      scope: 'HOUSEHOLD',
      netAmount: 10000,
      userId: 'u1',
      memberIds: ['u1', 'u2'],
      splitMode: 'PERCENTAGE',
      splitValues: [
        { userId: 'u1', value: 25 },
        { userId: 'u2', value: 75 },
      ],
    });
    expect(result).toEqual([
      { userId: 'u1', amount: 2500 },
      { userId: 'u2', amount: 7500 },
    ]);
  });

  it('household SHARES mode', () => {
    const result = buildPurchaseAllocations({
      scope: 'HOUSEHOLD',
      netAmount: 9000,
      userId: 'u1',
      memberIds: ['u1', 'u2'],
      splitMode: 'SHARES',
      splitValues: [
        { userId: 'u1', value: 1 },
        { userId: 'u2', value: 2 },
      ],
    });
    expect(result).toEqual([
      { userId: 'u1', amount: 3000 },
      { userId: 'u2', amount: 6000 },
    ]);
  });

  it('defaults to equal when no split provided', () => {
    const result = buildPurchaseAllocations({
      scope: 'HOUSEHOLD',
      netAmount: 10000,
      userId: 'u1',
      memberIds: ['u1', 'u2'],
    });
    expect(result).toEqual([
      { userId: 'u1', amount: 5000 },
      { userId: 'u2', amount: 5000 },
    ]);
  });
});
