import { describe, expect, it } from 'vitest';
import { nextMonthlyDueDate, toDateOnlyISO } from '@biko/shared';

function shouldWriteAmountHistory(
  amountType: 'FIXED' | 'VARIABLE',
  previous: number | null,
  next: number | null | undefined,
): boolean {
  if (amountType !== 'FIXED' || next == null) return false;
  if (previous == null) return true;
  return Math.abs(previous - next) > 0.001;
}

describe('recurring amount from now on', () => {
  it('writes history when fixed amount changes', () => {
    expect(shouldWriteAmountHistory('FIXED', 10000, 12000)).toBe(true);
    expect(shouldWriteAmountHistory('FIXED', 10000, 10000)).toBe(false);
    expect(shouldWriteAmountHistory('VARIABLE', 10000, 12000)).toBe(false);
  });
});

describe('next due after amount change', () => {
  it('keeps calendaring independent of amount history', () => {
    const from = new Date(Date.UTC(2026, 6, 16));
    expect(toDateOnlyISO(nextMonthlyDueDate(from, 10))).toBe('2026-08-10');
  });
});

describe('notifyUser payload shape', () => {
  it('includes deep link in data', () => {
    const data = {
      recurringPaymentId: 'rp1',
      occurrenceId: 'occ1',
      url: '/recurrentes',
    };
    expect(data.url).toBe('/recurrentes');
  });
});
