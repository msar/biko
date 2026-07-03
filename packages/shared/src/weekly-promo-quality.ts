import type { PromotionInput } from './promotion-recommender';

/** Cadenas/comercios con nombre propio — siempre accionables. */
const NAMED_STORE =
  /changom[aá]s|carrefour|coto|jumbo|disco|vea|\bd[ií]a\b|walmart|ypf|shell|axion|pa?ea|la anonima|la anónima|farmacity|supermercado|verduler|carrefour|makro|maxi|día/i;

/** Textos demasiado genéricos para Mi semana (salvo excepciones abajo). */
const GENERIC_PATTERNS = [
  /^comercios adheridos$/i,
  /^comercios que acepten modo$/i,
  /^consult[aá] los locales adheridos$/i,
  /^beneficio /i,
  /^venta seguro/i,
  /seguro de auto/i,
  /seguro de autos/i,
];

function matchesGeneric(text: string): boolean {
  return GENERIC_PATTERNS.some((p) => p.test(text));
}

/** Genéricos que SÍ aportan valor en su rubro. */
const ALLOWED_GENERIC: Array<{ pattern: RegExp; categoryPattern: RegExp }> = [
  { pattern: /supermercados que acepten modo/i, categoryPattern: /supermercado/i },
  {
    pattern: /estaciones de servicio (adheridas|que acepten)/i,
    categoryPattern: /combustible/i,
  },
];

function promoText(promo: Pick<PromotionInput, 'store' | 'notes' | 'categoryNames'>): string {
  return [promo.store, promo.notes].filter(Boolean).join(' ');
}

/**
 * Filtra promos poco accionables para Mi semana: seguros miscategorizados,
 * "comercios adheridos" genéricos, etc. Mantiene cadenas nombradas y
 * genéricos útiles (ej. "Supermercados que acepten MODO").
 */
export function isActionableWeeklyPromo(
  promo: Pick<PromotionInput, 'store' | 'notes' | 'categoryNames' | 'details' | 'sourceUrl'>,
): boolean {
  if (!promo.sourceUrl) return false;

  const text = promoText(promo);
  const store = promo.store?.trim() ?? '';
  const categories = promo.categoryNames?.join(' ') ?? '';

  if (/seguro/i.test(text) && !/combustible/i.test(categories)) return false;
  if (/seguro de auto/i.test(text)) return false;

  if (NAMED_STORE.test(text)) return true;

  for (const { pattern, categoryPattern } of ALLOWED_GENERIC) {
    if (pattern.test(store) || pattern.test(promo.notes ?? '')) {
      if (categoryPattern.test(categories)) return true;
    }
  }

  if (matchesGeneric(store) || matchesGeneric(promo.notes ?? '')) return false;

  // "Comercios adheridos" en título pero sin comercio nombrado.
  if (/^comercios adheridos$/i.test(store)) return false;

  return true;
}

/** Normaliza nombre de comercio para agrupar variantes (ej. varios % en Axion). */
export function weeklyPromoGroupKey(promo: Pick<PromotionInput, 'store' | 'notes' | 'entityName'>): string {
  const store = promo.store?.trim();
  if (store && !/consult|comercios adheridos|que acepten modo/i.test(store)) {
    return store.toLowerCase();
  }
  return (promo.notes ?? promo.entityName).toLowerCase();
}

export interface WeeklyPromoGroupLike {
  store: string | null;
  notes?: string | null;
  entityName: string;
}

export interface WeeklyDayLike<T extends WeeklyPromoGroupLike = WeeklyPromoGroupLike> {
  dayOfWeek: string;
  promotions: T[];
}

/** Quita promos cuyo comercio/grupo el hogar marcó como oculto en Mi semana. */
export function filterHiddenWeeklyGroups<T extends WeeklyPromoGroupLike>(
  days: WeeklyDayLike<T>[],
  hiddenGroupKeys: ReadonlySet<string> | string[],
): WeeklyDayLike<T>[] {
  const hidden = hiddenGroupKeys instanceof Set ? hiddenGroupKeys : new Set(hiddenGroupKeys);
  if (hidden.size === 0) return days;
  return days.map((day) => ({
    ...day,
    promotions: day.promotions.filter(
      (promo) =>
        !hidden.has(
          weeklyPromoGroupKey({
            store: promo.store,
            notes: promo.notes ?? null,
            entityName: promo.entityName,
          }),
        ),
    ),
  }));
}

/** Extrae monto mínimo de compra de textos MODO cuando está declarado. */
export function parseMinPurchaseAmount(texts: string[]): number | null {
  const joined = texts.join(' ');
  const patterns = [
    /compra m[ií]nima(?: de)?\s*\$?\s*([\d.]+)/i,
    /m[ií]nimo(?: de compra| de consumo)?\s*\$?\s*([\d.]+)/i,
    /consumo m[ií]nimo\s*\$?\s*([\d.]+)/i,
    /ticket m[ií]nimo\s*\$?\s*([\d.]+)/i,
  ];
  for (const pattern of patterns) {
    const match = joined.match(pattern);
    if (match) {
      const value = Number(match[1]!.replace(/\./g, ''));
      if (value >= 1000) return value;
    }
  }
  return null;
}

/** Ordena grupos poniendo favoritos primero, manteniendo el orden relativo dentro de cada grupo. */
export function sortWeeklyGroupsByFavorites<T extends { key: string }>(
  groups: T[],
  favoriteKeys: ReadonlySet<string> | string[],
): T[] {
  const favorites = favoriteKeys instanceof Set ? favoriteKeys : new Set(favoriteKeys);
  if (favorites.size === 0) return groups;
  const starred: T[] = [];
  const rest: T[] = [];
  for (const group of groups) {
    if (favorites.has(group.key)) starred.push(group);
    else rest.push(group);
  }
  return [...starred, ...rest];
}
