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

/** Href for an accommodation address: use as-is if URL, else Google Maps search. */
export function accommodationMapsHref(address: string): string {
  const trimmed = address.trim();
  return isHttpUrl(trimmed) ? trimmed : mapsUrl(trimmed);
}

export function tripInviteUrl(code: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return `${origin}/viajes/invitar/${code}`;
}

export function dateInputValue(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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
