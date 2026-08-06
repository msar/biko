import { describe, expect, it } from 'vitest';
import {
  calendarDateToUtc,
  todayYmdInTimeZone,
  ymdInTimeZone,
} from '../lib/calendar-date.js';

describe('calendar-date destination timezone', () => {
  it('encodes and decodes a calendar day in America/Argentina/Buenos_Aires', () => {
    const ymd = '2026-08-10';
    const instant = calendarDateToUtc(ymd, 'America/Argentina/Buenos_Aires');
    expect(ymdInTimeZone(instant, 'America/Argentina/Buenos_Aires')).toBe(ymd);
    // AR is UTC-3 → local noon is 15:00Z
    expect(instant.toISOString()).toBe('2026-08-10T15:00:00.000Z');
  });

  it('encodes and decodes a calendar day in Asia/Tokyo', () => {
    const ymd = '2026-08-10';
    const instant = calendarDateToUtc(ymd, 'Asia/Tokyo');
    expect(ymdInTimeZone(instant, 'Asia/Tokyo')).toBe(ymd);
    // Tokyo UTC+9 → local noon is 03:00Z
    expect(instant.toISOString()).toBe('2026-08-10T03:00:00.000Z');
  });

  it('does not shift the calendar day across zones when re-reading', () => {
    const ymd = '2026-12-31';
    const tokyo = calendarDateToUtc(ymd, 'Asia/Tokyo');
    const ba = calendarDateToUtc(ymd, 'America/Argentina/Buenos_Aires');
    expect(ymdInTimeZone(tokyo, 'Asia/Tokyo')).toBe(ymd);
    expect(ymdInTimeZone(ba, 'America/Argentina/Buenos_Aires')).toBe(ymd);
    expect(tokyo.toISOString()).not.toBe(ba.toISOString());
  });

  it('formats today in UTC as YYYY-MM-DD', () => {
    const fixed = new Date('2026-08-06T22:30:00.000Z');
    expect(todayYmdInTimeZone('UTC', fixed)).toBe('2026-08-06');
    expect(todayYmdInTimeZone('America/Argentina/Buenos_Aires', fixed)).toBe('2026-08-06');
    expect(todayYmdInTimeZone('Pacific/Kiritimati', fixed)).toBe('2026-08-07');
  });
});
