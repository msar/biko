import { describe, expect, it } from 'vitest';
import {
  monthlyDueDatesInRange,
  nextMonthlyDueDate,
  startOfUtcDay,
  toDateOnlyISO,
} from './recurring-dates';

describe('nextMonthlyDueDate', () => {
  it('returns due day later this month', () => {
    const from = new Date(Date.UTC(2026, 6, 10)); // Jul 10
    expect(toDateOnlyISO(nextMonthlyDueDate(from, 15))).toBe('2026-07-15');
  });

  it('rolls to next month when due day already passed', () => {
    const from = new Date(Date.UTC(2026, 6, 20));
    expect(toDateOnlyISO(nextMonthlyDueDate(from, 15))).toBe('2026-08-15');
  });
});

describe('monthlyDueDatesInRange', () => {
  it('lists dues inclusive', () => {
    const from = startOfUtcDay(new Date(Date.UTC(2026, 6, 1)));
    const through = startOfUtcDay(new Date(Date.UTC(2026, 8, 20)));
    const dates = monthlyDueDatesInRange(from, through, 10).map(toDateOnlyISO);
    expect(dates).toEqual(['2026-07-10', '2026-08-10', '2026-09-10']);
  });
});
