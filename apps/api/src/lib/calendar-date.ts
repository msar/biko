/** Calendar YYYY-MM-DD helpers in an IANA timezone (no extra deps). */

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isCalendarDateString(value: string): boolean {
  return YMD_RE.test(value);
}

export function parseCalendarDateString(value: string): { year: number; month: number; day: number } {
  const m = value.trim().match(YMD_RE);
  if (!m) throw new Error('Fecha inválida');
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  // Basic validity check via UTC date round-trip
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() + 1 !== month ||
    probe.getUTCDate() !== day
  ) {
    throw new Error('Fecha inválida');
  }
  return { year, month, day };
}

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function zonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);

  const map: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

/** Format an instant as YYYY-MM-DD in the given IANA timezone. */
export function ymdInTimeZone(date: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone);
  return `${String(p.year).padStart(4, '0')}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** Today's calendar date in the given IANA timezone. */
export function todayYmdInTimeZone(timeZone: string, now = new Date()): string {
  return ymdInTimeZone(now, timeZone);
}

/**
 * Encode a calendar date as a UTC instant at local `hour` in `timeZone`.
 * Default noon avoids most DST midnight edge cases.
 */
export function calendarDateToUtc(
  ymd: string,
  timeZone: string,
  hour = 12,
): Date {
  const { year, month, day } = parseCalendarDateString(ymd);
  let millis = Date.UTC(year, month - 1, day, hour, 0, 0);

  for (let i = 0; i < 4; i++) {
    const parts = zonedParts(new Date(millis), timeZone);
    const asIfUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    const want = Date.UTC(year, month - 1, day, hour, 0, 0);
    const delta = want - asIfUtc;
    if (delta === 0) break;
    millis += delta;
  }

  return new Date(millis);
}

/** Resolve storage timezone: destination IANA or UTC. */
export function tripTimeZone(destinationTimezone: string | null | undefined): string {
  return destinationTimezone?.trim() || 'UTC';
}

export function serializeCalendarDate(
  date: Date | null | undefined,
  destinationTimezone: string | null | undefined,
): string | null {
  if (!date) return null;
  return ymdInTimeZone(date, tripTimeZone(destinationTimezone));
}
