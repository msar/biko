/** Trip expense UI categories (fixed set for v1). */
export type TripExpenseCategory =
  | 'ALOJAMIENTO'
  | 'VUELOS'
  | 'TRANSPORTE'
  | 'COMIDA'
  | 'RESTAURANTES'
  | 'ACTIVIDADES'
  | 'OTROS';

export const TRIP_EXPENSE_CATEGORIES: readonly TripExpenseCategory[] = [
  'ALOJAMIENTO',
  'VUELOS',
  'TRANSPORTE',
  'COMIDA',
  'RESTAURANTES',
  'ACTIVIDADES',
  'OTROS',
] as const;

/** Spanish labels for trip UI. */
export const TRIP_CATEGORY_LABELS: Record<TripExpenseCategory, string> = {
  ALOJAMIENTO: 'Alojamiento',
  VUELOS: 'Vuelos',
  TRANSPORTE: 'Transporte',
  COMIDA: 'Comida / supermercado',
  RESTAURANTES: 'Restaurantes',
  ACTIVIDADES: 'Tickets / actividades',
  OTROS: 'Otros',
};

/**
 * Maps trip UI category → global seed Category.name under the Viajes group.
 * Names are distinct from household categories (e.g. Movilidad viaje ≠ Transporte).
 */
export const TRIP_CATEGORY_TO_SEED_NAME: Record<TripExpenseCategory, string> = {
  ALOJAMIENTO: 'Alojamiento',
  VUELOS: 'Vuelos',
  TRANSPORTE: 'Movilidad viaje',
  COMIDA: 'Comida viaje',
  RESTAURANTES: 'Restaurantes viaje',
  ACTIVIDADES: 'Actividades',
  OTROS: 'Viajes',
};

export function tripCategorySeedName(category: TripExpenseCategory): string {
  return TRIP_CATEGORY_TO_SEED_NAME[category];
}
