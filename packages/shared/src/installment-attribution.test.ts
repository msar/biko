import { describe, expect, it } from 'vitest';
import { attributionDate, attributionMonth } from './installment-attribution';

describe('attributionDate', () => {
  it('uses purchaseDate for single-installment purchases', () => {
    const purchase = new Date(2026, 5, 20); // 2026-06-20
    const due = new Date(2026, 6, 10); // 2026-07-10
    expect(attributionDate(1, purchase, due)).toBe(purchase);
  });

  it('uses dueDate for 2+ installment purchases', () => {
    const purchase = new Date(2026, 5, 20);
    const due = new Date(2026, 6, 10);
    expect(attributionDate(2, purchase, due)).toBe(due);
    expect(attributionDate(6, purchase, due)).toBe(due);
  });
});

describe('attributionMonth', () => {
  it('formats the single-installment month from purchaseDate', () => {
    expect(attributionMonth(1, new Date(2026, 5, 20), new Date(2026, 6, 10))).toBe('2026-06');
  });

  it('formats the multi-installment month from dueDate', () => {
    expect(attributionMonth(3, new Date(2026, 5, 20), new Date(2026, 6, 10))).toBe('2026-07');
  });
});
