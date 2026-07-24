import { describe, expect, it } from 'vitest';
import { generateDebtInstallments } from '@biko/shared';

/** Mirrors createDebtFromPurchase paid-prefix rule for statement cuota current. */
function mirrorPurchaseInstallmentsForDebt(
  installments: Array<{ number: number; amount: number; dueDate: Date }>,
  installmentCurrent: number,
) {
  return installments.map((i) => ({
    ...i,
    paid: i.number <= installmentCurrent,
  }));
}

function debtStatusFromInstallments(installments: Array<{ paid: boolean }>): 'OPEN' | 'SETTLED' {
  return installments.length > 0 && installments.every((i) => i.paid) ? 'SETTLED' : 'OPEN';
}

describe('debt installment mirroring from statement', () => {
  it('marks cuotas up to current as paid (C.02/06 → 1–2 paid)', () => {
    const bank = generateDebtInstallments(60000, 6, new Date(2026, 0, 10));
    const mirrored = mirrorPurchaseInstallmentsForDebt(bank, 2);
    expect(mirrored.filter((i) => i.paid).map((i) => i.number)).toEqual([1, 2]);
    expect(debtStatusFromInstallments(mirrored)).toBe('OPEN');
  });

  it('settles when current equals total', () => {
    const bank = generateDebtInstallments(10000, 1, new Date(2026, 0, 10));
    const mirrored = mirrorPurchaseInstallmentsForDebt(bank, 1);
    expect(debtStatusFromInstallments(mirrored)).toBe('SETTLED');
  });
});

describe('expense dashboard exclusion rule', () => {
  it('purchase with linked debt is excluded from expense totals', () => {
    const purchases = [
      { id: 'p1', debt: null, amount: 100 },
      { id: 'p2', debt: { id: 'd1' }, amount: 50 },
    ];
    const expenseTotal = purchases
      .filter((p) => p.debt == null)
      .reduce((s, p) => s + p.amount, 0);
    expect(expenseTotal).toBe(100);
  });
});
