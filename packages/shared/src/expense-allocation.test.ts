import { describe, expect, it } from 'vitest';
import {
  allocationShareForInstallment,
  buildCustomAllocations,
  buildDefaultAllocations,
  buildPurchaseAllocations,
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

  it('household with custom share', () => {
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
});
