import { describe, expect, it } from 'vitest';
import { PaymentMethodType } from './enums';
import { calculateDiscount, generateInstallments } from './installment-calculator';

describe('calculateDiscount', () => {
  it('applies plain percentage without cap', () => {
    expect(calculateDiscount(100000, 25, null)).toEqual({ discountAmount: 25000, netAmount: 75000 });
  });

  it('caps the discount (brief example: 100k, 25%, cap 20k)', () => {
    expect(calculateDiscount(100000, 25, 20000)).toEqual({ discountAmount: 20000, netAmount: 80000 });
  });

  it('returns zero discount when no percentage', () => {
    expect(calculateDiscount(50000, null, null)).toEqual({ discountAmount: 0, netAmount: 50000 });
  });

  it('rounds to 2 decimals', () => {
    const { discountAmount, netAmount } = calculateDiscount(999.99, 33.33, null);
    expect(discountAmount).toBeCloseTo(333.3, 2);
    expect(discountAmount + netAmount).toBeCloseTo(999.99, 2);
  });
});

describe('generateInstallments', () => {
  const creditCard = { type: PaymentMethodType.CREDIT_CARD, closingDay: 15, dueDay: 10 };

  it('non-credit methods settle immediately in one installment', () => {
    const result = generateInstallments(5000, 3, new Date(2026, 6, 2), {
      type: PaymentMethodType.CASH,
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ number: 1, amount: 5000 });
    expect(result[0]!.dueDate).toEqual(new Date(2026, 6, 2));
  });

  it('purchase before closing day bills next month', () => {
    // Compra 2026-07-10, cierre el 15 → cae en el resumen de julio, vence 10 de agosto.
    const result = generateInstallments(30000, 3, new Date(2026, 6, 10), creditCard);
    expect(result).toHaveLength(3);
    expect(result[0]!.dueDate).toEqual(new Date(2026, 7, 10));
    expect(result[1]!.dueDate).toEqual(new Date(2026, 8, 10));
    expect(result[2]!.dueDate).toEqual(new Date(2026, 9, 10));
  });

  it('purchase after closing day rolls into the following cycle', () => {
    // Compra 2026-07-20, cierre el 15 → resumen de agosto, vence 10 de septiembre.
    const result = generateInstallments(30000, 1, new Date(2026, 6, 20), creditCard);
    expect(result[0]!.dueDate).toEqual(new Date(2026, 8, 10));
  });

  it('wraps across year end', () => {
    // Compra 2026-12-20, cierre 15 → resumen de enero 2027, vence 10 de febrero 2027.
    const result = generateInstallments(12000, 2, new Date(2026, 11, 20), creditCard);
    expect(result[0]!.dueDate).toEqual(new Date(2027, 1, 10));
    expect(result[1]!.dueDate).toEqual(new Date(2027, 2, 10));
  });

  it('last installment absorbs rounding drift so the sum is exact', () => {
    const result = generateInstallments(100, 3, new Date(2026, 6, 1), creditCard);
    const sum = result.reduce((acc, i) => acc + i.amount, 0);
    expect(sum).toBeCloseTo(100, 2);
    expect(result[0]!.amount).toBeCloseTo(33.33, 2);
    expect(result[2]!.amount).toBeCloseTo(33.34, 2);
  });
});
