import { inferPromotionProvinces, mapModoBankToCatalogName, parseDiscountFromText, parseMinPurchaseAmount } from '@biko/shared';
import type { FastifyBaseLogger } from 'fastify';
import type { BankResolverCtx, PromotionSource, ScrapedPromo } from './promotion-sync.js';

// ============================================================
// Scraper de promociones de MODO.
//
// La página https://www.modo.com.ar/promos consume el backend
// https://promoshub.modo.com.ar/promos/api/rewards (descubierto inspeccionando
// los chunks JS del sitio). El endpoint clave es:
//
//   GET /slots?limit=&page=&fcalcstatus=running&categories=<id>
//
// Hay ~23k promos en total (muchísimos comercios hiper-locales), así que solo
// importamos los rubros que mapeamos a nuestras categorías seed, con un tope
// de páginas por rubro. Si la API cambia o falla, el sync deja las promos
// existentes como están (last-good) y registra el error en PromotionSync.
// ============================================================

export type { ScrapedPromo, SyncResult } from './promotion-sync.js';

const API_BASE = 'https://promoshub.modo.com.ar/promos/api/rewards';
const PROMOS_URL = 'https://www.modo.com.ar/promos';
export function buildModoSourceUrl(slug: string | null | undefined): string {
  const trimmed = slug?.trim();
  return trimmed ? `${PROMOS_URL}/${trimmed}` : PROMOS_URL;
}
const PAGE_SIZE = 200;
const MAX_PAGES_PER_CATEGORY = 2;

const MODO_CATEGORY_MAP: Record<number, string> = {
  1: 'Supermercado',
  2: 'Restaurante',
  3: 'Indumentaria',
  4: 'Farmacia',
  5: 'Combustible',
  7: 'Hogar',
};

const DAY_LETTER: Record<string, string> = {
  L: 'MONDAY',
  M: 'TUESDAY',
  X: 'WEDNESDAY',
  J: 'THURSDAY',
  V: 'FRIDAY',
  S: 'SATURDAY',
  D: 'SUNDAY',
};

export function parseDaysOfWeek(raw: unknown): string[] {
  const letters = String(raw ?? '').toUpperCase().replace(/[^LMXJVSD]/g, '');
  const days = new Set<string>();
  for (const letter of letters) {
    const mapped = DAY_LETTER[letter];
    if (mapped) days.add(mapped);
  }
  return days.size === 0 || days.size === 7 ? [] : [...days];
}

export function parsePercentage(raw: unknown): number | null {
  if (typeof raw === 'number' && raw > 0 && raw <= 100) return raw;
  const match = String(raw ?? '').match(/(\d{1,2}(?:[.,]\d+)?)\s*%/);
  if (!match) return null;
  const value = Number(match[1]!.replace(',', '.'));
  return value > 0 && value <= 100 ? value : null;
}

interface ModoCard {
  promo_id?: string;
  id?: string;
  title?: string;
  where?: string | boolean | null;
  status?: string;
  calculated_status?: string;
  days_of_week?: string;
  start_date?: string | null;
  stop_date?: string | null;
  slug?: string;
  search_tags?: string;
  stores_whitelist?: boolean;
  payment_flow?: string;
  content?: {
    row?: Array<{
      text?: string | null;
      extra_data?: Array<{ name_bank?: string }> | null;
    }>;
    image?: {
      primary_image?: string | null;
      secondary_image?: string | null;
    };
  };
}

const GENERIC_STORE =
  /comercios adheridos|que acepten modo|consult[aá]|almacenes que|estaciones de servicio adheridas|comercios de .+ adheridos|beneficio /i;

function cleanStoreName(name: string): string {
  return name.replace(/\s+/g, ' ').trim();
}

/** Extrae nombre del comercio desde where, filas del card o título MODO. */
export function extractStoreName(card: ModoCard, title: string, rowTexts: string[]): string | null {
  const where = typeof card.where === 'string' ? card.where.trim() : '';
  if (where && !GENERIC_STORE.test(where)) return cleanStoreName(where);

  for (const text of rowTexts) {
    const t = text.trim();
    if (!t) continue;
    if (/reintegro|cuotas|^\d+$|bancos|exclusivo|desde el|hasta|^del \d/i.test(t)) continue;
    if (GENERIC_STORE.test(t)) continue;
    return cleanStoreName(t);
  }

  return parseStoreFromTitle(title);
}

export function parseStoreFromTitle(title: string): string | null {
  const trimmed = title.trim();
  if (!trimmed) return null;

  const patterns = [
    /^\d+%\s+en\s+(.+)$/i,
    /^\d+\s+CSI\s+en\s+(.+)$/i,
    /^\d+\s+cuotas\s+sin\s+inter[eé]s\s+en\s+(.+)$/i,
  ];
  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match?.[1] && !GENERIC_STORE.test(match[1])) return cleanStoreName(match[1]);
  }

  if (!/reintegro|cuotas sin inter[eé]s|^\d+%$/i.test(trimmed) && !GENERIC_STORE.test(trimmed)) {
    return cleanStoreName(trimmed);
  }
  return null;
}

export function extractBankNames(rows: NonNullable<ModoCard['content']>['row']): string[] {
  const banks = new Set<string>();
  for (const row of rows ?? []) {
    for (const item of row.extra_data ?? []) {
      const name = item.name_bank?.trim();
      if (name) banks.add(name);
    }
  }
  return [...banks];
}

export function buildPromoNotes(title: string, store: string | null, discountLabel: string): string {
  const trimmedTitle = title.trim();
  if (store) {
    const storeKey = store.toLowerCase().slice(0, Math.min(store.length, 12));
    if (trimmedTitle && trimmedTitle.toLowerCase().includes(storeKey)) return trimmedTitle;
    return `${discountLabel} en ${store}`;
  }
  return trimmedTitle || discountLabel;
}

/** Solo promos vigentes según MODO (status + fechas). */
export function isModoPromoActive(card: ModoCard, now = new Date()): boolean {
  const calculated = (card.calculated_status ?? '').toUpperCase();
  const status = (card.status ?? '').toLowerCase();

  if (calculated && calculated !== 'RUNNING') return false;
  if (!calculated && status !== 'active') return false;

  if (card.stop_date && new Date(card.stop_date) < now) return false;
  if (card.start_date && new Date(card.start_date) > now) return false;
  return true;
}

export function extractPromoDetails(card: ModoCard): string[] {
  const rows = card.content?.row ?? [];
  const rowTexts = rows.map((r) => String(r.text ?? '').trim()).filter(Boolean);
  const details: string[] = [];

  for (const text of rowTexts) {
    if (/^\d{3,}$/.test(text)) continue;
    if (/reintegro|cuotas|desde el|hasta|exclusivo|adherid|bancos adheridos|presencial|online/i.test(text)) {
      details.push(text);
    }
  }

  const where = typeof card.where === 'string' ? card.where.trim() : '';
  if (card.stores_whitelist) {
    if (/consult/i.test(where)) details.push('Consultá los locales adheridos');
    else details.push('Aplica en locales adheridos');
  }

  if (card.payment_flow === 'instore') details.push('Compra presencial');
  if (card.payment_flow === 'online') details.push('Compra online');

  const gasHint = [card.title, where, rowTexts.join(' ')].join(' ');
  if (/ypf|shell|axion|estaci[oó]n(es)?\s*de\s*servicio|combustible/i.test(gasHint)) {
    details.push('Estaciones de servicio adheridas');
  }

  return [...new Set(details)];
}

/**
 * Normaliza una card del slots API a ScrapedPromo. Devuelve null para promos
 * que no están corriendo o sin beneficio parseable.
 */
export function normalizeCard(card: ModoCard, categoryName: string | null, now = new Date()): ScrapedPromo | null {
  const externalId = String(card.promo_id ?? card.id ?? '').trim();
  const title = String(card.title ?? '').trim();
  if (!externalId || !title) return null;
  if (!isModoPromoActive(card, now)) return null;

  const rows = card.content?.row ?? [];
  const rowTexts = rows.map((r) => String(r.text ?? ''));

  const parsedDiscount = parseDiscountFromText([title, ...rowTexts]);
  if (!parsedDiscount) return null;

  const pct = parsedDiscount.percentage ?? parsePercentage(title) ?? parsePercentage(rowTexts.join(' ')) ?? 0;

  let cap: number | null = null;
  for (const text of rowTexts) {
    if (/^\d{3,}$/.test(text.trim())) {
      cap = Number(text.trim());
      break;
    }
  }

  const bankNames = extractBankNames(rows);

  const store = extractStoreName(card, title, rowTexts);
  const where = typeof card.where === 'string' && card.where.trim() ? card.where.trim() : null;
  const displayTitle = buildPromoNotes(title, store, parsedDiscount.label);

  const imageUrl = card.content?.image?.primary_image ?? card.content?.image?.secondary_image ?? null;
  const details = extractPromoDetails(card);
  const minPurchaseAmount = parseMinPurchaseAmount([title, ...rowTexts, ...details]);
  if (minPurchaseAmount != null) {
    details.push(`Compra mínima ${minPurchaseAmount.toLocaleString('es-AR')}`);
  }
  const provinces = inferPromotionProvinces({
    title,
    store,
    where,
    tags: card.search_tags,
  });

  return {
    externalId,
    title: displayTitle,
    store,
    categoryName,
    bankNames,
    discountKind: parsedDiscount.kind,
    discountLabel: parsedDiscount.label,
    discountPercentage: pct,
    discountCap: cap && cap > 0 ? cap : null,
    minPurchaseAmount,
    daysOfWeek: parseDaysOfWeek(card.days_of_week),
    validFrom: card.start_date ?? null,
    validTo: card.stop_date ?? null,
    sourceUrl: buildModoSourceUrl(card.slug),
    imageUrl,
    details,
    provinces,
    storesAdherents: Boolean(card.stores_whitelist),
    paymentFlow: card.payment_flow ?? null,
  };
}

async function fetchJson(url: string, ms = 20000): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; BikoHousehold/1.0)',
        Accept: 'application/json',
      },
    });
    if (!res.ok) throw new Error(`${url} returned ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchModoPromos(log: FastifyBaseLogger): Promise<ScrapedPromo[]> {
  const byId = new Map<string, ScrapedPromo>();

  for (const [modoCategoryId, categoryName] of Object.entries(MODO_CATEGORY_MAP)) {
    for (let page = 1; page <= MAX_PAGES_PER_CATEGORY; page++) {
      const url = `${API_BASE}/slots?limit=${PAGE_SIZE}&page=${page}&fcalcstatus=running&categories=${modoCategoryId}`;
      const json = (await fetchJson(url)) as {
        data?: { cards?: ModoCard[] };
        metadata?: { pagination?: { total_pages?: number } };
      };
      const cards = json.data?.cards ?? [];
      for (const card of cards) {
        const promo = normalizeCard(card, categoryName);
        if (promo && !byId.has(promo.externalId)) byId.set(promo.externalId, promo);
      }
      const totalPages = json.metadata?.pagination?.total_pages ?? 1;
      if (page >= totalPages || cards.length === 0) break;
    }
  }

  if (byId.size === 0) throw new Error('MODO slots API returned no parseable promos (API changed?)');
  log.info({ count: byId.size }, 'MODO promos fetched from slots API');
  return [...byId.values()];
}

function resolveModoBanks(rawBankNames: string[], ctx: BankResolverCtx) {
  const sponsorBanks = [...new Set(rawBankNames.map(mapModoBankToCatalogName))];
  if (sponsorBanks.length === 0) {
    return { entityId: ctx.defaultEntityId, sponsorBank: null, sponsorBanks: [] };
  }
  if (sponsorBanks.length === 1) {
    const name = sponsorBanks[0]!;
    const entityId = ctx.entityByName.get(name.toLowerCase()) ?? ctx.defaultEntityId;
    return { entityId, sponsorBank: name, sponsorBanks };
  }
  return { entityId: ctx.defaultEntityId, sponsorBank: null, sponsorBanks };
}

export const modoSource: PromotionSource = {
  source: 'MODO',
  entityName: 'modo',
  fetch: fetchModoPromos,
  resolveBanks: resolveModoBanks,
};
