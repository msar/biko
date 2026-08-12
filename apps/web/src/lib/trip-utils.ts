import { TRIP_CATEGORY_LABELS, type TripExpenseCategory } from '@biko/shared';

export const TRIP_CATEGORY_COLORS: Record<TripExpenseCategory, string> = {
  ALOJAMIENTO: '#4a7fb5',
  VUELOS: '#3d6f9e',
  TRANSPORTE: '#5b8a9e',
  COMIDA: '#4f8a5b',
  RESTAURANTES: '#b5567a',
  ACTIVIDADES: '#8a5b9e',
  OTROS: '#888888',
};

export { TRIP_CATEGORY_LABELS };

export const TRIP_STATUS_LABEL: Record<string, string> = {
  PLANNING: 'Planificando',
  ACTIVE: 'Activo',
  CLOSED: 'Cerrado',
};

export function mapsUrl(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

/** True when the value is already an http(s) URL (e.g. a Google Maps link). */
export function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

/** True when the value is a Google Maps URL (maps.app.goo.gl, google.com/maps, …). */
export function isGoogleMapsUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!isHttpUrl(trimmed)) return false;
  try {
    const host = new URL(trimmed).hostname.toLowerCase();
    return (
      host === 'maps.app.goo.gl' ||
      host === 'maps.google.com' ||
      host === 'goo.gl' ||
      host.endsWith('.google.com') && host.includes('maps') ||
      (host === 'www.google.com' || host === 'google.com') && /\/maps\b/i.test(trimmed)
    );
  } catch {
    return false;
  }
}

/** Href for an accommodation address: use as-is if URL, else Google Maps search. */
export function accommodationMapsHref(address: string): string {
  const trimmed = address.trim();
  return isHttpUrl(trimmed) ? trimmed : mapsUrl(trimmed);
}

export function tripInviteUrl(code: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return `${origin}/viajes/invitar/${code}`;
}

/** YYYY-MM-DD for `<input type="date">` — uses calendar prefix to avoid TZ shift. */
export function dateInputValue(iso: string | null | undefined): string {
  if (!iso) return '';
  const m = String(iso).match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1]!;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** Normalize stored HH:mm (or HH:mm:ss from browsers) for `<input type="time">`. */
export function timeInputValue(value: string | null | undefined): string {
  if (!value) return '';
  const match = value.trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) return '';
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return '';
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function formatStayMoment(
  dateIso: string | null | undefined,
  time: string | null | undefined,
  fmtDate: (iso: string) => string,
): string | null {
  if (!dateIso && !time) return null;
  const datePart = dateIso ? fmtDate(dateIso) : null;
  const timePart = timeInputValue(time) || null;
  if (datePart && timePart) return `${datePart}, ${timePart}`;
  return datePart ?? timePart;
}

export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Today's YYYY-MM-DD in an IANA timezone (falls back to local calendar). */
export function todayYmdInTimeZone(timeZone?: string | null): string {
  if (!timeZone) return todayIso();
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date());
    const map: Record<string, string> = {};
    for (const p of parts) {
      if (p.type !== 'literal') map[p.type] = p.value;
    }
    return `${map.year}-${map.month}-${map.day}`;
  } catch {
    return todayIso();
  }
}

export const MEAL_SLOT_LABEL: Record<string, string> = {
  BREAKFAST: 'Desayuno',
  LUNCH: 'Almuerzo',
  DINNER: 'Cena',
};

export const ARRIVAL_KIND_LABEL: Record<string, string> = {
  CHECK_IN: 'Check-in',
  CHECK_OUT: 'Check-out',
  FLIGHT: 'Vuelo',
  CAR: 'Auto',
};

/** Inclusive list of YYYY-MM-DD from start to end (UTC calendar arithmetic). */
export function eachCalendarDay(startYmd: string, endYmd: string): string[] {
  const start = startYmd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const end = endYmd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!start || !end) return [];
  const days: string[] = [];
  let cur = Date.UTC(Number(start[1]), Number(start[2]) - 1, Number(start[3]));
  const last = Date.UTC(Number(end[1]), Number(end[2]) - 1, Number(end[3]));
  if (cur > last) return [];
  while (cur <= last) {
    const d = new Date(cur);
    days.push(
      `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`,
    );
    cur += 24 * 60 * 60 * 1000;
  }
  return days;
}

export function formatTripExpensePayers(
  expense: {
    paidByMember: { displayName: string };
    payments?: Array<{ displayName: string; amount: number }>;
  },
  fmtMoney: (n: number) => string,
): string {
  const payments = expense.payments ?? [];
  if (payments.length <= 1) {
    const name = payments[0]?.displayName ?? expense.paidByMember.displayName;
    return `Pagó ${name}`;
  }
  return `Pagaron ${payments.map((p) => `${p.displayName} (${fmtMoney(p.amount)})`).join(', ')}`;
}

const TRIP_SPLIT_MODE_LABEL: Record<string, string> = {
  EQUAL: 'Igual entre todos',
  ASSIGN: 'Asignado a uno',
  AMOUNT: 'Por montos',
  SHARES: 'Por partes',
  PERCENTAGE: 'Por porcentaje',
};

export function tripExpenseSplitModeLabel(splitMode: string): string {
  return TRIP_SPLIT_MODE_LABEL[splitMode] ?? splitMode;
}
