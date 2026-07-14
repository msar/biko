import {
  inferPromotionProvinces,
  parseDiscountFromText,
  parseMinPurchaseAmount,
  type ParsedDiscount,
} from '@biko/shared';
import type { FastifyBaseLogger } from 'fastify';
import { buildPromoNotes, parsePercentage } from './modo-scraper.js';
import type { PromotionSource, ScrapedPromo } from './promotion-sync.js';

// ============================================================
// Scraper de promociones de Mercado Pago.
//
// https://promociones.mercadopago.com.ar/ es un sitio WordPress con
// Search & Filter Pro. Las promos se renderizan en HTML; pidiendo
// ?_sf_ppp=100 obtenemos hasta 100 cards en una sola página.
//
// Si el sitio cambia o falla, el sync deja las promos existentes
// (last-good) y registra el error en PromotionSync.
// ============================================================

const PROMOS_URL = 'https://promociones.mercadopago.com.ar/?_sf_ppp=100';
const SITE_BASE = 'https://promociones.mercadopago.com.ar';
export interface MercadoPagoCard {
  externalId: string;
  store: string;
  badges: string[];
  description: string;
  sourceUrl: string;
  legals: string;
  imageUrl: string | null;
}

const MONTHS: Record<string, number> = {
  enero: 0,
  febrero: 1,
  marzo: 2,
  abril: 3,
  mayo: 4,
  junio: 5,
  julio: 6,
  agosto: 7,
  septiembre: 8,
  setiembre: 8,
  octubre: 9,
  noviembre: 10,
  diciembre: 11,
};

const STORE_CATEGORY_HINTS: Array<{ pattern: RegExp; category: string }> = [
  { pattern: /farmaci|farmaonline|drogui/i, category: 'Farmacia' },
  { pattern: /vea|disco|carrefour|jumbo|coto|supermerc|veggie|changom/i, category: 'Supermercado' },
  { pattern: /restaurant|burger|mcdonald|starbucks|pedidos/i, category: 'Restaurante' },
  { pattern: /easy|homecenter|sodimac|hogar|blaisten/i, category: 'Hogar' },
  { pattern: /despegar|turismo|aerol[ií]nea|hotel|almundo/i, category: 'Transporte' },
  { pattern: /shell|ypf|axion|puma|gulf|combustible/i, category: 'Combustible' },
  { pattern: /zara|falabella|garbarino|indumentaria|nike|adidas|moda/i, category: 'Indumentaria' },
];

function dedupeBadges(badges: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const badge of badges) {
    const trimmed = badge.replace(/\s+/g, ' ').trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

/** Parsea cards desde el HTML de promociones.mercadopago.com.ar. */
export function parseMercadoPagoCards(html: string): MercadoPagoCard[] {
  const cards: MercadoPagoCard[] = [];
  const parts = html.split(/<div class="kiyo__cards--col (\d+)\s+">/);
  for (let i = 1; i < parts.length; i += 2) {
    const externalId = parts[i]!.trim();
    const block = parts[i + 1] ?? '';
    const store = block.match(/<h3>([^<]+)<\/h3>/)?.[1]?.trim();
    if (!externalId || !store) continue;

    const badges = dedupeBadges(
      [...block.matchAll(/kiyo__cards--badge[^>]*>\s*<span>([^<]+)<\/span>/g)].map((m) => m[1]!),
    );
    const description =
      block.match(/<h4>Promoción<\/h4>\s*<p>([\s\S]*?)<\/p>/)?.[1]?.replace(/\s+/g, ' ').trim() ?? '';
    const sourceUrl =
      block.match(/href="(https:\/\/promociones\.mercadopago\.com\.ar\/seller\/[^"]+)"/)?.[1] ??
      `${SITE_BASE}/seller/${externalId}/`;
    const legals = block.match(/<h6>Legales<\/h6>\s*<small>([\s\S]*?)<\/small>/)?.[1]?.trim() ?? '';
    const imageUrl = block.match(/<img decoding="async" src="([^"]+)"/)?.[1] ?? null;

    cards.push({ externalId, store, badges, description, sourceUrl, legals, imageUrl });
  }
  return cards;
}

export function parseMercadoPagoValidDates(
  legals: string,
  now = new Date(),
): { validFrom: string | null; validTo: string | null } {
  const range = legals.match(/v[aá]lido\s+del\s+(\d{1,2})\s+al\s+(\d{1,2})\s+de\s+(\w+)/i);
  if (!range) return { validFrom: null, validTo: null };

  const month = MONTHS[range[3]!.toLowerCase()];
  if (month == null) return { validFrom: null, validTo: null };

  const year = now.getUTCFullYear();
  const fromDay = Number(range[1]);
  const toDay = Number(range[2]);
  const validFrom = new Date(Date.UTC(year, month, fromDay, 0, 0, 0));
  const validTo = new Date(Date.UTC(year, month, toDay, 23, 59, 59, 999));
  return { validFrom: validFrom.toISOString(), validTo: validTo.toISOString() };
}

export function parseMercadoPagoMinPurchase(texts: string[]): number | null {
  const fromShared = parseMinPurchaseAmount(texts);
  if (fromShared != null) return fromShared;

  const joined = texts.join(' ');
  const desde = joined.match(/desde\s*\$?\s*([\d.]+)/i);
  if (desde) {
    const value = Number(desde[1]!.replace(/\./g, ''));
    if (value >= 1000) return value;
  }
  return null;
}

export function parseMercadoPagoCap(texts: string[]): number | null {
  for (const text of texts) {
    const match = text.match(/tope\s+de\s+reintegro\s+\$?\s*([\d.]+)/i);
    if (match) return Number(match[1]!.replace(/\./g, ''));
  }
  return null;
}

/** Prioriza descuento/reintegro sobre cuotas (badges secundarios suelen ser CSI). */
export function parseMercadoPagoDiscount(badges: string[], description: string): ParsedDiscount | null {
  const unique = dedupeBadges(badges);
  const primary = unique.filter((badge) => !/\bcuotas?\s*sin\s*inter[eé]s/i.test(badge));

  for (const text of [...primary, description]) {
    if (/^2x1$/i.test(text.trim())) {
      return { kind: 'OTHER', label: '2x1', percentage: null };
    }
    const parsed = parseDiscountFromText([text]);
    if (parsed) return parsed;
  }

  return parseDiscountFromText(unique.concat(description));
}

export function inferMercadoPagoCategory(store: string, description: string): string | null {
  const haystack = `${store} ${description}`;
  for (const { pattern, category } of STORE_CATEGORY_HINTS) {
    if (pattern.test(haystack)) return category;
  }
  return null;
}

export function extractMercadoPagoDetails(card: MercadoPagoCard): string[] {
  const details: string[] = [];
  for (const badge of card.badges) {
    if (/\bcuotas?\s*sin\s*inter[eé]s/i.test(badge)) details.push(badge);
  }
  if (/tienda online|compra online|e-commerce/i.test(card.description)) details.push('Compra online');
  if (/presencial|local/i.test(card.description)) details.push('Compra presencial');
  if (card.legals) details.push(card.legals.trim());
  return [...new Set(details.filter(Boolean))];
}

export function isMercadoPagoPromoActive(
  validFrom: string | null,
  validTo: string | null,
  now = new Date(),
): boolean {
  if (validTo && new Date(validTo) < now) return false;
  if (validFrom && new Date(validFrom) > now) return false;
  return true;
}

export function normalizeMercadoPagoCard(card: MercadoPagoCard, now = new Date()): ScrapedPromo | null {
  const parsedDiscount = parseMercadoPagoDiscount(card.badges, card.description);
  if (!parsedDiscount) return null;

  const { validFrom, validTo } = parseMercadoPagoValidDates(card.legals, now);
  if (!isMercadoPagoPromoActive(validFrom, validTo, now)) return null;

  const pct =
    parsedDiscount.percentage ??
    parsePercentage(card.badges.join(' ')) ??
    parsePercentage(card.description) ??
    0;

  const details = extractMercadoPagoDetails(card);
  const minPurchaseAmount = parseMercadoPagoMinPurchase([card.description, card.legals, ...details]);
  if (minPurchaseAmount != null) {
    details.push(`Compra mínima ${minPurchaseAmount.toLocaleString('es-AR')}`);
  }

  const discountCap = parseMercadoPagoCap([card.legals, card.description]);
  const store = card.store.trim();
  const discountLabel = parsedDiscount.label;
  const title = buildPromoNotes(card.description, store, discountLabel);

  return {
    externalId: card.externalId,
    title,
    store,
    categoryName: inferMercadoPagoCategory(store, card.description),
    bankNames: [],
    discountKind: parsedDiscount.kind,
    discountLabel,
    discountPercentage: pct,
    discountCap,
    minPurchaseAmount,
    daysOfWeek: [],
    validFrom,
    validTo,
    sourceUrl: card.sourceUrl,
    imageUrl: card.imageUrl,
    details,
    provinces: inferPromotionProvinces({ title: card.description, store, where: card.description }),
    storesAdherents: false,
    paymentFlow: /tienda online|compra online/i.test(card.description) ? 'online' : null,
  };
}

async function fetchHtml(url: string, ms = 20000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; BikoHousehold/1.0)',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    if (!res.ok) throw new Error(`${url} returned ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchMercadoPagoPromos(log: FastifyBaseLogger): Promise<ScrapedPromo[]> {
  const html = await fetchHtml(PROMOS_URL);
  const cards = parseMercadoPagoCards(html);
  const byId = new Map<string, ScrapedPromo>();

  for (const card of cards) {
    const promo = normalizeMercadoPagoCard(card);
    if (promo && !byId.has(promo.externalId)) byId.set(promo.externalId, promo);
  }

  if (byId.size === 0) throw new Error('Mercado Pago promos page returned no parseable cards (site changed?)');
  log.info({ count: byId.size, rawCards: cards.length }, 'Mercado Pago promos fetched');
  return [...byId.values()];
}

export const mercadoPagoSource: PromotionSource = {
  source: 'MERCADOPAGO',
  entityName: 'mercadopago',
  fetch: fetchMercadoPagoPromos,
};
