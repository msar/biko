const CACHE_KEY = 'biko:store-suggestions';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface StoreSuggestionsCache {
  updatedAt: string;
  stores: string[];
}

function normalizeKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

function isValidStoreName(store: string | null | undefined): store is string {
  if (!store) return false;
  const trimmed = store.trim();
  if (trimmed.length < 2) return false;
  if (/consult|comercios adheridos|que acepten modo|cualquier comercio/i.test(trimmed)) return false;
  return true;
}

/** Une nombres de comercio sin duplicar (case-insensitive), preservando el primer casing. */
export function mergeStoreNames(...sources: (string | null | undefined)[][]): string[] {
  const byKey = new Map<string, string>();
  for (const list of sources) {
    for (const raw of list) {
      if (!isValidStoreName(raw)) continue;
      const trimmed = raw.trim();
      const key = normalizeKey(trimmed);
      if (!byKey.has(key)) byKey.set(key, trimmed);
    }
  }
  return [...byKey.values()].sort((a, b) => a.localeCompare(b, 'es'));
}

export function readStoreSuggestionsCache(): StoreSuggestionsCache | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoreSuggestionsCache;
    if (!parsed.updatedAt || !Array.isArray(parsed.stores)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function isStoreSuggestionsCacheStale(cache: StoreSuggestionsCache): boolean {
  return Date.now() - new Date(cache.updatedAt).getTime() > CACHE_TTL_MS;
}

export function writeStoreSuggestionsCache(stores: string[]): StoreSuggestionsCache {
  const cache: StoreSuggestionsCache = { updatedAt: new Date().toISOString(), stores };
  localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  return cache;
}

/** Agrega un comercio al cache (p. ej. después de guardar un gasto). */
export function rememberStoreFromExpense(store: string): string[] {
  const trimmed = store.trim();
  if (!isValidStoreName(trimmed)) return readStoreSuggestionsCache()?.stores ?? [];
  const existing = readStoreSuggestionsCache();
  const stores = mergeStoreNames(existing?.stores ?? [], [trimmed]);
  writeStoreSuggestionsCache(stores);
  return stores;
}

/**
 * Devuelve sugerencias cacheadas. Si el cache venció (7 días), lo reconstruye
 * desde promos activas y gastos previos del hogar.
 */
export function ensureStoreSuggestionsCache(params: {
  promotions: Array<{ store: string | null }>;
  expenses: Array<{ store: string }>;
}): string[] {
  const cached = readStoreSuggestionsCache();
  if (cached && !isStoreSuggestionsCacheStale(cached)) {
    return cached.stores;
  }

  const fromPromos = params.promotions.map((p) => p.store);
  const fromExpenses = params.expenses.map((e) => e.store);
  const stores = mergeStoreNames(cached?.stores ?? [], fromPromos, fromExpenses);
  writeStoreSuggestionsCache(stores);
  return stores;
}

export function filterStoreSuggestions(stores: string[], query: string, limit = 8): string[] {
  const q = normalizeKey(query);
  if (!q) return stores.slice(0, limit);
  return stores.filter((s) => normalizeKey(s).includes(q)).slice(0, limit);
}
