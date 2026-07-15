/** Calendar helpers for monthly recurring due dates (no TZ libs). */

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** YYYY-MM-DD for a Date in local calendar terms (UTC date parts). */
export function toDateOnlyISO(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

export function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function addUtcDays(d: Date, days: number): Date {
  const out = startOfUtcDay(d);
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

/**
 * Due day clamped to month length (dueDay is 1–28 in product; still clamp safely).
 */
export function dateForDueDay(year: number, monthIndex0: number, dueDay: number): Date {
  const lastDay = new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate();
  const day = Math.min(Math.max(1, dueDay), lastDay);
  return new Date(Date.UTC(year, monthIndex0, day));
}

/** Next monthly due on/after `from` (UTC day). */
export function nextMonthlyDueDate(from: Date, dueDay: number): Date {
  const base = startOfUtcDay(from);
  const y = base.getUTCFullYear();
  const m = base.getUTCMonth();
  const candidate = dateForDueDay(y, m, dueDay);
  if (candidate >= base) return candidate;
  const nextMonth = m === 11 ? 0 : m + 1;
  const nextYear = m === 11 ? y + 1 : y;
  return dateForDueDay(nextYear, nextMonth, dueDay);
}

/** List monthly due dates in [from, through] inclusive (UTC days). */
export function monthlyDueDatesInRange(from: Date, through: Date, dueDay: number): Date[] {
  const start = startOfUtcDay(from);
  const end = startOfUtcDay(through);
  const dates: Date[] = [];
  let cursor = nextMonthlyDueDate(start, dueDay);
  while (cursor <= end) {
    dates.push(cursor);
    const y = cursor.getUTCFullYear();
    const m = cursor.getUTCMonth();
    const nextMonth = m === 11 ? 0 : m + 1;
    const nextYear = m === 11 ? y + 1 : y;
    cursor = dateForDueDay(nextYear, nextMonth, dueDay);
  }
  return dates;
}
