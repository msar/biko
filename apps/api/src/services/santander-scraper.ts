import {
  inferPromotionProvinces,
  parseDiscountFromText,
  parseMinPurchaseAmount,
  type BankProgram,
} from '@biko/shared';
import type { FastifyBaseLogger } from 'fastify';
import { buildPromoNotes, parsePercentage } from './modo-scraper.js';
import type { PromotionSource, ScrapedPromo } from './promotion-sync.js';

// ============================================================
// Scraper de beneficios Santander (catálogo general + Sorpresa/Select).
//
// UI: https://www.santander.com.ar/personas/beneficios
//     https://www.santander.com.ar/personas/beneficios#/results?exclusive-code=SOR
//
// El sitio es un SPA; intentamos endpoints JSON públicos conocidos / descubiertos.
// Si todos fallan, el sync deja last-good y registra el error en PromotionSync.
// ============================================================

const BENEFICIOS_URL = 'https://www.santander.com.ar/personas/beneficios';
const CANDIDATE_APIS = [
  'https://www.santander.com.ar/app/benefits/api/offers?page=0&size=200',
  'https://www.santander.com.ar/app/benefits/api/offers?page=0&size=200&exclusiveCode=',
  'https://www.santander.com.ar/content/santander-ar/es_ar/personas/beneficios/_jcr_content.offers.json',
  'https://www.santander.com.ar/bin/santander/benefits/offers?size=200',
];

export interface SantanderOffer {
  id?: string | number;
  externalId?: string;
  title?: string;
  name?: string;
  description?: string;
  store?: string;
  merchant?: string;
  brand?: string;
  discountLabel?: string;
  percentage?: number;
  cap?: number | null;
  exclusiveCode?: string | null;
  exclusiveCodes?: string[] | null;
  exclusiveness?: string | null;
  segment?: string | null;
  paymentFlow?: string | null;
  channel?: string | null;
  daysOfWeek?: string[] | string | null;
  validFrom?: string | null;
  validTo?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  imageUrl?: string | null;
  image?: string | null;
  url?: string | null;
  slug?: string | null;
  category?: string | null;
  rubro?: string | null;
  tags?: string | null;
  location?: string | null;
  provinces?: string[] | null;
  details?: string[] | null;
  legales?: string | null;
}

const CATEGORY_HINTS: Array<{ pattern: RegExp; category: string }> = [
  { pattern: /farmaci|farma/i, category: 'Farmacia' },
  { pattern: /super|changom|carrefour|coto|jumbo|disco|vea/i, category: 'Supermercado' },
  { pattern: /restaurant|gastronom|burger|cafe|caf[eé]/i, category: 'Restaurante' },
  { pattern: /shell|ypf|axion|combustible|estacion/i, category: 'Combustible' },
  { pattern: /easy|sodimac|hogar|homecenter/i, category: 'Hogar' },
  { pattern: /indumentaria|moda|zara|nike|adidas|compras/i, category: 'Compras' },
];

const DAY_MAP: Record<string, string> = {
  lunes: 'MONDAY',
  monday: 'MONDAY',
  martes: 'TUESDAY',
  tuesday: 'TUESDAY',
  miercoles: 'WEDNESDAY',
  miércoles: 'WEDNESDAY',
  wednesday: 'WEDNESDAY',
  jueves: 'THURSDAY',
  thursday: 'THURSDAY',
  viernes: 'FRIDAY',
  friday: 'FRIDAY',
  sabado: 'SATURDAY',
  sábado: 'SATURDAY',
  saturday: 'SATURDAY',
  domingo: 'SUNDAY',
  sunday: 'SUNDAY',
  L: 'MONDAY',
  M: 'TUESDAY',
  X: 'WEDNESDAY',
  J: 'THURSDAY',
  V: 'FRIDAY',
  S: 'SATURDAY',
  D: 'SUNDAY',
};

function guessCategory(text: string): string | null {
  for (const { pattern, category } of CATEGORY_HINTS) {
    if (pattern.test(text)) return category;
  }
  return null;
}

export function parseSantanderDays(raw: string[] | string | null | undefined): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    const days = new Set<string>();
    for (const item of raw) {
      const key = String(item).trim().toLowerCase();
      const mapped = DAY_MAP[key] ?? DAY_MAP[key.slice(0, 1).toUpperCase()];
      if (mapped) days.add(mapped);
    }
    return days.size === 0 || days.size === 7 ? [] : [...days];
  }
  const letters = String(raw).toUpperCase().replace(/[^LMXJVSD]/g, '');
  if (letters.length > 0 && letters.length < 7) {
    return parseSantanderDays(letters.split(''));
  }
  const days = new Set<string>();
  for (const [key, value] of Object.entries(DAY_MAP)) {
    if (key.length > 1 && new RegExp(key, 'i').test(String(raw))) days.add(value);
  }
  return days.size === 0 || days.size === 7 ? [] : [...days];
}

export function inferSantanderAudience(offer: SantanderOffer): BankProgram[] {
  const blob = [
    offer.exclusiveCode,
    ...(offer.exclusiveCodes ?? []),
    offer.exclusiveness,
    offer.segment,
    offer.title,
    offer.name,
    offer.description,
    offer.tags,
    ...(offer.details ?? []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  const segments: BankProgram[] = [];
  if (/\bsor\b|sorpresa/.test(blob)) segments.push('SANTANDER_SORPRESA');
  if (/\bselect\b|exclusive-code=sel|\bsel\b/.test(blob)) segments.push('SANTANDER_SELECT');
  return [...new Set(segments)];
}

function inferPaymentFlow(offer: SantanderOffer): string | null {
  if (offer.paymentFlow === 'instore' || offer.paymentFlow === 'online') return offer.paymentFlow;
  const blob = [offer.channel, offer.description, offer.tags, offer.title].filter(Boolean).join(' ');
  if (/presencial|tienda f[ií]sica|sucursal/i.test(blob)) return 'instore';
  if (/online|ecommerce|e-commerce|web/i.test(blob)) return 'online';
  return null;
}

function collectOffers(payload: unknown): SantanderOffer[] {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload as SantanderOffer[];
  if (typeof payload !== 'object') return [];
  const obj = payload as Record<string, unknown>;
  for (const key of ['offers', 'data', 'content', 'results', 'items', 'promotions', 'benefits']) {
    const value = obj[key];
    if (Array.isArray(value)) return value as SantanderOffer[];
    if (value && typeof value === 'object') {
      const nested = collectOffers(value);
      if (nested.length) return nested;
    }
  }
  return [];
}

export function normalizeSantanderOffer(offer: SantanderOffer, now = new Date()): ScrapedPromo | null {
  const title = String(offer.title ?? offer.name ?? '').trim();
  const store = String(offer.store ?? offer.merchant ?? offer.brand ?? '').trim() || null;
  if (!title && !store) return null;

  const externalId = String(offer.externalId ?? offer.id ?? offer.slug ?? '').trim();
  if (!externalId) return null;

  const textParts = [title, store, offer.description, offer.discountLabel, offer.legales, ...(offer.details ?? [])];
  const parsedDiscount = parseDiscountFromText(textParts.filter(Boolean) as string[]);
  const pct =
    offer.percentage ??
    parsedDiscount?.percentage ??
    parsePercentage(title) ??
    parsePercentage(offer.description ?? '') ??
    0;
  if (!parsedDiscount && pct <= 0) return null;

  const discountLabel = offer.discountLabel ?? parsedDiscount?.label ?? `${pct}% de reintegro`;
  const discountKind = parsedDiscount?.kind ?? 'PERCENTAGE_REFUND';
  const audienceSegments = inferSantanderAudience(offer);
  const details = [...(offer.details ?? [])];
  if (offer.description) details.push(offer.description);
  if (offer.legales) details.push(offer.legales);
  if (audienceSegments.includes('SANTANDER_SORPRESA')) details.push('Requiere Sorpresa Santander');
  if (audienceSegments.includes('SANTANDER_SELECT')) details.push('Requiere Santander Select');

  const paymentFlow = inferPaymentFlow(offer);
  if (paymentFlow === 'instore') details.push('Compra presencial');
  if (paymentFlow === 'online') details.push('Compra online');

  const minPurchaseAmount = parseMinPurchaseAmount(textParts.filter(Boolean) as string[]);
  const categoryName = guessCategory([title, store, offer.category, offer.rubro, offer.tags].filter(Boolean).join(' '));
  const displayTitle = buildPromoNotes(title || store || 'Beneficio Santander', store, discountLabel);
  const sourceUrl = offer.url?.trim() || (offer.slug ? `${BENEFICIOS_URL}#/detail/${offer.slug}` : BENEFICIOS_URL);
  const provinces =
    offer.provinces?.length ?
      offer.provinces
    : inferPromotionProvinces({
        title,
        store,
        where: offer.location,
        tags: offer.tags,
        details,
      });

  const validFrom = offer.validFrom ?? offer.startDate ?? null;
  const validTo = offer.validTo ?? offer.endDate ?? null;
  if (validTo && new Date(validTo) < now) return null;

  return {
    externalId,
    title: displayTitle,
    store,
    categoryName,
    bankNames: ['Santander'],
    discountKind,
    discountLabel,
    discountPercentage: pct,
    discountCap: offer.cap && offer.cap > 0 ? offer.cap : null,
    minPurchaseAmount,
    daysOfWeek: parseSantanderDays(offer.daysOfWeek),
    validFrom,
    validTo,
    sourceUrl,
    imageUrl: offer.imageUrl ?? offer.image ?? null,
    details: [...new Set(details.filter(Boolean))],
    provinces,
    storesAdherents: /locales adheridos|consultar locales/i.test(details.join(' ')),
    paymentFlow,
    audienceSegments,
  };
}

async function fetchJson(url: string, ms = 25000): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; BikoHousehold/1.0)',
        Accept: 'application/json, text/plain, */*',
        Referer: BENEFICIOS_URL,
        Origin: 'https://www.santander.com.ar',
      },
    });
    if (!res.ok) throw new Error(`${url} returned ${res.status}`);
    const ct = res.headers.get('content-type') ?? '';
    if (!/json/i.test(ct)) {
      const text = await res.text();
      try {
        return JSON.parse(text);
      } catch {
        throw new Error(`${url} did not return JSON`);
      }
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchSantanderPromos(log: FastifyBaseLogger): Promise<ScrapedPromo[]> {
  const errors: string[] = [];
  for (const url of CANDIDATE_APIS) {
    try {
      const payload = await fetchJson(url);
      const offers = collectOffers(payload);
      const promos = offers
        .map((offer) => normalizeSantanderOffer(offer))
        .filter((p): p is ScrapedPromo => p != null);
      if (promos.length > 0) {
        log.info({ url, count: promos.length }, 'Santander benefits fetched');
        const byId = new Map(promos.map((p) => [p.externalId, p]));
        return [...byId.values()];
      }
      errors.push(`${url}: empty offers`);
    } catch (err) {
      errors.push(`${url}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  throw new Error(`Santander benefits unreachable. Tried: ${errors.join(' | ')}`);
}

export const santanderSource: PromotionSource = {
  source: 'SANTANDER',
  entityName: 'Santander',
  fetch: fetchSantanderPromos,
  resolveBanks: (_bankNames, ctx) => ({
    entityId: ctx.defaultEntityId,
    sponsorBank: 'Santander',
    sponsorBanks: ['Santander'],
  }),
};
