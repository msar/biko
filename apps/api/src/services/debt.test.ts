import { describe, expect, it } from 'vitest';
import { generateDebtInstallments } from '@biko/shared';

/** Contact debt schedule from a bank purchase: amounts/dates copy, always start unpaid. */
function mirrorPurchaseInstallmentsForDebt(
  installments: Array<{ number: number; amount: number; dueDate: Date }>,
) {
  return installments.map((i) => ({
    ...i,
    paid: false,
  }));
}

function debtStatusFromInstallments(installments: Array<{ paid: boolean }>): 'OPEN' | 'SETTLED' {
  return installments.length > 0 && installments.every((i) => i.paid) ? 'SETTLED' : 'OPEN';
}

describe('debt installment mirroring from statement', () => {
  it('keeps all contact cuotas unpaid even mid-plan (C.02/06)', () => {
    const bank = generateDebtInstallments(60000, 6, new Date(2026, 0, 10));
    const mirrored = mirrorPurchaseInstallmentsForDebt(bank);
    expect(mirrored.every((i) => !i.paid)).toBe(true);
    expect(debtStatusFromInstallments(mirrored)).toBe('OPEN');
  });

  it('one-shot import stays OPEN until the contact pays', () => {
    const bank = generateDebtInstallments(10000, 1, new Date(2026, 0, 10));
    const mirrored = mirrorPurchaseInstallmentsForDebt(bank);
    expect(debtStatusFromInstallments(mirrored)).toBe('OPEN');
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
