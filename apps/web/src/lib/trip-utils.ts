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

export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
