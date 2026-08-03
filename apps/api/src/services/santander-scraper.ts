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
// MF:  /api/microfrontBeneficios → microfront-benefits
// BFF: /bff-benefits/brands, /bff-benefits/brands/{id}, /bff-benefits/categories?type=EXC
// Exclusive codes: SOR (Sorpresa), SEC (Select)
// ============================================================

const ORIGIN = 'https://www.santander.com.ar';
const BENEFICIOS_URL = `${ORIGIN}/personas/beneficios`;
const BFF_BASE = `${ORIGIN}/bff-benefits`;
const PAGE_SIZE = 50;
const MAX_PAGES = 40;
const DETAIL_CONCURRENCY = 6;

/** Loose shape for list + detail payloads from /bff-benefits. */
export interface SantanderOffer {
  id?: string | number;
  externalId?: string;
  idPromotion?: string | number;
  title?: string;
  name?: string;
  description?: string;
  store?: string;
  merchant?: string;
  brand?: string;
  discountLabel?: string;
  percentage?: number;
  customerDiscount?: number;
  cap?: number | null;
  topAmount?: number | null;
  exclusiveCode?: string | null;
  exclusiveCodes?: string[] | null;
  exclusiveness?: string | null;
  segment?: string | null;
  paymentFlow?: string | null;
  channel?: string | null;
  daysOfWeek?: string[] | string | null;
  monday?: boolean;
  tuesday?: boolean;
  wednesday?: boolean;
  thursday?: boolean;
  friday?: boolean;
  saturday?: boolean;
  sunday?: boolean;
  fullWeek?: boolean;
  validFrom?: string | null;
  validTo?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  startDatePublication?: string | null;
  endDatePublication?: string | null;
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
  additionalText?: string | null;
  legal?: string | null;
  texts?: { title?: string; description?: string; discount?: number } | null;
  brands?: Array<{ id?: number | string; name?: string; desktopImage?: string; mobileImage?: string }> | null;
  categories?: Array<{ code?: string; description?: string }> | null;
  tag?: { code?: string; description?: string } | null;
  paymentType?: { code?: string; description?: string } | null;
}

interface SantanderBrandListItem {
  id?: string | number;
  name?: string;
  desktopImage?: string;
  mobileImage?: string;
}

const CATEGORY_HINTS: Array<{ pattern: RegExp; category: string }> = [
  { pattern: /farmaci|farma/i, category: 'Farmacia' },
  { pattern: /super|changom|carrefour|coto|jumbo|disco|vea/i, category: 'Supermercado' },
  { pattern: /restaurant|gastronom|burger|cafe|caf[eé]/i, category: 'Restaurante' },
  { pattern: /shell|ypf|axion|combustible|estacion/i, category: 'Combustible' },
  { pattern: /easy|sodimac|hogar|homecenter/i, category: 'Hogar' },
  { pattern: /indumentaria|moda|zara|nike|adidas|compras/i, category: 'Compras' },
  { pattern: /viaje|turismo|hotel|aéreo|aereo|colectivo/i, category: 'Viajes' },
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

function stripHtml(value: string | null | undefined): string {
  if (!value) return '';
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

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

function daysFromFlags(offer: SantanderOffer): string[] {
  if (offer.fullWeek) return [];
  const flags: Array<[boolean | undefined, string]> = [
    [offer.monday, 'MONDAY'],
    [offer.tuesday, 'TUESDAY'],
    [offer.wednesday, 'WEDNESDAY'],
    [offer.thursday, 'THURSDAY'],
    [offer.friday, 'FRIDAY'],
    [offer.saturday, 'SATURDAY'],
    [offer.sunday, 'SUNDAY'],
  ];
  if (!flags.some(([on]) => on != null)) return parseSantanderDays(offer.daysOfWeek);
  const days = flags.filter(([on]) => on).map(([, day]) => day);
  return days.length === 0 || days.length === 7 ? [] : days;
}

export function inferSantanderAudience(offer: SantanderOffer): BankProgram[] {
  const categoryCodes = (offer.categories ?? []).map((c) => c.code ?? c.description ?? '').join(' ');
  const blob = [
    offer.exclusiveCode,
    ...(offer.exclusiveCodes ?? []),
    offer.exclusiveness,
    offer.segment,
    offer.title,
    offer.name,
    offer.description,
    offer.tags,
    offer.additionalText,
    offer.legal,
    offer.legales,
    offer.texts?.title,
    offer.texts?.description,
    categoryCodes,
    offer.tag?.code,
    offer.tag?.description,
    ...(offer.details ?? []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  const segments: BankProgram[] = [];
  if (/\bsor\b|sorpresa/.test(blob)) segments.push('SANTANDER_SORPRESA');
  // BFF exclusive code for Select is SEC (not SEL).
  if (/\bsec\b|\bsel\b|\bselect\b|exclusive-code=sec|exclusive-code=sel/.test(blob)) {
    segments.push('SANTANDER_SELECT');
  }
  return [...new Set(segments)];
}

function inferPaymentFlow(offer: SantanderOffer): string | null {
  if (offer.paymentFlow === 'instore' || offer.paymentFlow === 'online') return offer.paymentFlow;
  const blob = [
    offer.channel,
    offer.description,
    offer.additionalText,
    offer.tags,
    offer.title,
    offer.paymentType?.description,
    offer.paymentType?.code,
  ]
    .filter(Boolean)
    .join(' ');
  if (/presencial|tienda f[ií]sica|sucursal|en tiendas/i.test(blob)) return 'instore';
  if (/online|ecommerce|e-commerce|web|tienda online/i.test(blob)) return 'online';
  return null;
}

function brandNameOf(offer: SantanderOffer): string | null {
  const nested = offer.brands?.[0]?.name?.trim();
  if (nested) return nested;
  return String(offer.store ?? offer.merchant ?? offer.brand ?? offer.name ?? '').trim() || null;
}

function publicationTitle(offer: SantanderOffer): string {
  const fromTexts = offer.texts?.title?.trim();
  if (fromTexts) return fromTexts;
  const pct = offer.customerDiscount ?? offer.percentage ?? offer.texts?.discount;
  if (pct != null && pct > 0) return `${pct}% de ahorro`;
  return String(offer.title ?? offer.name ?? '').trim();
}

export function normalizeSantanderOffer(offer: SantanderOffer, now = new Date()): ScrapedPromo | null {
  const store = brandNameOf(offer);
  const title = publicationTitle(offer);
  if (!title && !store) return null;

  const externalId = String(
    offer.externalId ?? offer.idPromotion ?? offer.id ?? offer.slug ?? '',
  ).trim();
  if (!externalId) return null;

  const additional = stripHtml(offer.additionalText);
  const legal = stripHtml(offer.legal ?? offer.legales);
  const description = stripHtml(offer.description ?? offer.texts?.description ?? '');
  const textParts = [title, store, description, additional, legal, offer.discountLabel, ...(offer.details ?? [])];
  const parsedDiscount = parseDiscountFromText(textParts.filter(Boolean) as string[]);
  const pct =
    offer.customerDiscount ??
    offer.percentage ??
    offer.texts?.discount ??
    parsedDiscount?.percentage ??
    parsePercentage(title) ??
    parsePercentage(description) ??
    0;
  if (!parsedDiscount && pct <= 0) return null;

  const discountLabel = offer.discountLabel ?? parsedDiscount?.label ?? `${pct}% de reintegro`;
  const discountKind = parsedDiscount?.kind ?? 'PERCENTAGE_REFUND';
  const audienceSegments = inferSantanderAudience({
    ...offer,
    title,
    description: [description, additional].filter(Boolean).join(' '),
  });
  const details = [...(offer.details ?? [])];
  if (description) details.push(description);
  if (additional) details.push(additional);
  if (legal) details.push(legal);
  if (audienceSegments.includes('SANTANDER_SORPRESA')) details.push('Requiere Sorpresa Santander');
  if (audienceSegments.includes('SANTANDER_SELECT')) details.push('Requiere Santander Select');

  const paymentFlow = inferPaymentFlow({ ...offer, description: details.join(' ') });
  if (paymentFlow === 'instore') details.push('Compra presencial');
  if (paymentFlow === 'online') details.push('Compra online');

  const categoryFromApi = offer.categories?.find((c) => c.code && c.code !== 'DES')?.description;
  const categoryName =
    categoryFromApi ??
    guessCategory([title, store, offer.category, offer.rubro, offer.tags, categoryFromApi].filter(Boolean).join(' '));

  const brandId = offer.brands?.[0]?.id;
  const sourceUrl =
    offer.url?.trim() ||
    (brandId != null
      ? `${BENEFICIOS_URL}#/brand?brandId=${brandId}`
      : offer.slug
        ? `${BENEFICIOS_URL}#/detail/${offer.slug}`
        : BENEFICIOS_URL);

  const imageUrl =
    offer.imageUrl ??
    offer.image ??
    offer.brands?.[0]?.desktopImage ??
    offer.brands?.[0]?.mobileImage ??
    null;

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

  const validFrom = offer.validFrom ?? offer.startDate ?? offer.startDatePublication ?? null;
  const validTo = offer.validTo ?? offer.endDate ?? offer.endDatePublication ?? null;
  if (validTo && new Date(validTo) < now) return null;

  const cap = offer.cap ?? offer.topAmount ?? null;

  return {
    externalId,
    title: buildPromoNotes(title || store || 'Beneficio Santander', store, discountLabel),
    store,
    categoryName,
    bankNames: ['Santander'],
    discountKind,
    discountLabel,
    discountPercentage: pct,
    discountCap: cap && cap > 0 ? cap : null,
    minPurchaseAmount: parseMinPurchaseAmount(textParts.filter(Boolean) as string[]),
    daysOfWeek: daysFromFlags(offer),
    validFrom,
    validTo,
    sourceUrl,
    imageUrl,
    details: [...new Set(details.filter(Boolean))],
    provinces,
    storesAdherents: /locales adheridos|consultar locales/i.test(details.join(' ')),
    paymentFlow,
    audienceSegments,
  };
}

async function fetchJson(url: string, ms = 30000): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        Accept: 'application/json, text/plain, */*',
        'Accept-Language': 'es-AR,es;q=0.9',
        Referer: BENEFICIOS_URL,
        Origin: ORIGIN,
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

function asItems(payload: unknown): unknown[] {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (typeof payload !== 'object') return [];
  const obj = payload as Record<string, unknown>;
  if (Array.isArray(obj.items)) return obj.items;
  for (const key of ['offers', 'data', 'content', 'results', 'promotions', 'benefits']) {
    const value = obj[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

function brandIdOf(item: SantanderBrandListItem | SantanderOffer): string | null {
  const id = item.id;
  if (id == null || id === '') return null;
  // UI sometimes zero-pads ("0245"); BFF accepts both.
  return String(id).replace(/^0+/, '') || '0';
}

async function listBrandIds(exclusive: string | undefined, log: FastifyBaseLogger): Promise<string[]> {
  const brands = new Set<string>();
  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({
      limit: String(PAGE_SIZE),
      page: String(page),
    });
    if (exclusive) params.set('exclusive', exclusive);
    const url = `${BFF_BASE}/brands?${params}`;
    const payload = await fetchJson(url);
    const items = asItems(payload) as SantanderBrandListItem[];
    if (items.length === 0) break;
    for (const item of items) {
      const id = brandIdOf(item);
      if (id) brands.add(id);
    }
    const total =
      payload && typeof payload === 'object' && 'totalItems' in payload
        ? Number((payload as { totalItems?: number }).totalItems)
        : NaN;
    log.info(
      { exclusive: exclusive ?? 'all', page, batch: items.length, total: Number.isFinite(total) ? total : undefined },
      'Santander brands page',
    );
    if (items.length < PAGE_SIZE) break;
    if (Number.isFinite(total) && (page + 1) * PAGE_SIZE >= total) break;
  }
  return [...brands];
}

async function fetchBrandPublications(brandId: string): Promise<SantanderOffer[]> {
  const payload = await fetchJson(`${BFF_BASE}/brands/${brandId}`);
  return asItems(payload) as SantanderOffer[];
}

async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

export async function fetchSantanderPromos(log: FastifyBaseLogger): Promise<ScrapedPromo[]> {
  const errors: string[] = [];

  // Smoke-check the real BFF before paging.
  try {
    await fetchJson(`${BFF_BASE}/categories?type=EXC`);
  } catch (err) {
    errors.push(`categories: ${err instanceof Error ? err.message : String(err)}`);
  }

  const brandIds = new Set<string>();
  for (const exclusive of [undefined, 'SOR', 'SEC'] as const) {
    try {
      for (const id of await listBrandIds(exclusive, log)) brandIds.add(id);
    } catch (err) {
      errors.push(
        `brands${exclusive ? `?exclusive=${exclusive}` : ''}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  if (brandIds.size === 0) {
    throw new Error(
      `Santander benefits unreachable. Tried: ${BFF_BASE}/brands. ${errors.join(' | ') || 'no brands'}`,
    );
  }

  const publicationBatches = await mapPool([...brandIds], DETAIL_CONCURRENCY, async (brandId) => {
    try {
      return await fetchBrandPublications(brandId);
    } catch (err) {
      log.warn({ brandId, err }, 'Santander brand detail failed');
      return [] as SantanderOffer[];
    }
  });

  const promos = publicationBatches
    .flat()
    .map((offer) => normalizeSantanderOffer(offer))
    .filter((p): p is ScrapedPromo => p != null);

  if (promos.length === 0) {
    throw new Error(
      `Santander benefits unreachable. Listed ${brandIds.size} brands but parsed 0 promos. ${errors.join(' | ')}`,
    );
  }

  log.info({ brands: brandIds.size, count: promos.length }, 'Santander benefits fetched');
  const byId = new Map(promos.map((p) => [p.externalId, p]));
  return [...byId.values()];
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
