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
// Scraper de promociones Galicia / Galicia Eminent.
//
// UI: https://www.galicia.ar/personas/buscador-de-promociones
// SPA: https://beneficios.galicia.ar/
// BFF: https://loyalty.bff.bancogalicia.com.ar/personalizacion/v1/...
//
// El BFF suele estar detrás de WAF; intentamos varios endpoints con
// headers de browser. Si todos fallan, el sync deja last-good.
// ============================================================

const BUSCADOR_URL = 'https://www.galicia.ar/personas/buscador-de-promociones';
const BFF_BASE = 'https://loyalty.bff.bancogalicia.com.ar';
const CANDIDATE_APIS = [
  `${BFF_BASE}/personalizacion/v1/promociones/catalogo?page=1&pageSize=200&idAudiencia=1`,
  `${BFF_BASE}/catalogo/v1/promociones?page=1&pageSize=200`,
  `${BFF_BASE}/personalizacion/v1/promociones/list/agrupador/1/carruseles`,
];

export interface GaliciaPromo {
  id?: string | number;
  idPromocion?: string | number;
  titulo?: string;
  title?: string;
  nombre?: string;
  descripcion?: string;
  description?: string;
  marca?: { nombre?: string; name?: string; urlTiendaOnline?: string } | string;
  store?: string;
  porcentaje?: number;
  porcentajeReintegro?: number;
  tope?: number | null;
  topeReintegro?: number | null;
  modeloAtencion?: string | null;
  ModeloAtencion?: string | null;
  segmento?: string | null;
  eminent?: boolean;
  paymentFlow?: string | null;
  canal?: string | null;
  dias?: string[] | string | null;
  daysOfWeek?: string[] | string | null;
  fechaDesde?: string | null;
  fechaHasta?: string | null;
  validFrom?: string | null;
  validTo?: string | null;
  imagen?: string | null;
  imageUrl?: string | null;
  categoria?: string | { nombre?: string; name?: string } | null;
  rubro?: string | null;
  provincias?: string[] | null;
  provincia?: string | null;
  localidad?: string | null;
  legales?: string | null;
  details?: string[] | null;
  slug?: string | null;
  url?: string | null;
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
  martes: 'TUESDAY',
  miercoles: 'WEDNESDAY',
  miércoles: 'WEDNESDAY',
  jueves: 'THURSDAY',
  viernes: 'FRIDAY',
  sabado: 'SATURDAY',
  sábado: 'SATURDAY',
  domingo: 'SUNDAY',
  monday: 'MONDAY',
  tuesday: 'TUESDAY',
  wednesday: 'WEDNESDAY',
  thursday: 'THURSDAY',
  friday: 'FRIDAY',
  saturday: 'SATURDAY',
  sunday: 'SUNDAY',
};

function brandName(marca: GaliciaPromo['marca']): string | null {
  if (!marca) return null;
  if (typeof marca === 'string') return marca.trim() || null;
  return String(marca.nombre ?? marca.name ?? '').trim() || null;
}

function categoryNameOf(promo: GaliciaPromo): string | null {
  if (typeof promo.categoria === 'string' && promo.categoria.trim()) return promo.categoria.trim();
  if (promo.categoria && typeof promo.categoria === 'object') {
    const name = promo.categoria.nombre ?? promo.categoria.name;
    if (name) return name;
  }
  if (promo.rubro) return promo.rubro;
  const blob = [promo.titulo, promo.title, brandName(promo.marca)].filter(Boolean).join(' ');
  for (const { pattern, category } of CATEGORY_HINTS) {
    if (pattern.test(blob)) return category;
  }
  return null;
}

export function parseGaliciaDays(raw: string[] | string | null | undefined): string[] {
  if (!raw) return [];
  const items = Array.isArray(raw) ? raw : String(raw).split(/[,|;]/);
  const days = new Set<string>();
  for (const item of items) {
    const key = item.trim().toLowerCase();
    const mapped = DAY_MAP[key];
    if (mapped) days.add(mapped);
  }
  return days.size === 0 || days.size === 7 ? [] : [...days];
}

export function inferGaliciaAudience(promo: GaliciaPromo): BankProgram[] {
  const blob = [
    promo.modeloAtencion,
    promo.ModeloAtencion,
    promo.segmento,
    promo.titulo,
    promo.title,
    promo.descripcion,
    promo.description,
    ...(promo.details ?? []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  if (promo.eminent || /eminent|[eé]minent/.test(blob)) return ['GALICIA_EMINENT'];
  return [];
}

function inferPaymentFlow(promo: GaliciaPromo): string | null {
  if (promo.paymentFlow === 'instore' || promo.paymentFlow === 'online') return promo.paymentFlow;
  const blob = [promo.canal, promo.descripcion, promo.description, brandName(promo.marca)].filter(Boolean).join(' ');
  if (/online|ecommerce|e-commerce|tienda online/i.test(blob)) return 'online';
  if (/presencial|sucursal|local/i.test(blob)) return 'instore';
  const marca = typeof promo.marca === 'object' ? promo.marca : null;
  if (marca?.urlTiendaOnline) return 'online';
  return null;
}

function collectPromos(payload: unknown): GaliciaPromo[] {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload as GaliciaPromo[];
  if (typeof payload !== 'object') return [];
  const obj = payload as Record<string, unknown>;
  for (const key of ['data', 'promociones', 'promotions', 'items', 'content', 'results', 'carruseles']) {
    const value = obj[key];
    if (Array.isArray(value)) {
      // carruseles may nest promos
      if (value.length && value[0] && typeof value[0] === 'object' && 'promociones' in (value[0] as object)) {
        return value.flatMap((c) => collectPromos(c));
      }
      return value as GaliciaPromo[];
    }
    if (value && typeof value === 'object') {
      const nested = collectPromos(value);
      if (nested.length) return nested;
    }
  }
  return [];
}

export function normalizeGaliciaPromo(promo: GaliciaPromo, now = new Date()): ScrapedPromo | null {
  const title = String(promo.titulo ?? promo.title ?? promo.nombre ?? '').trim();
  const store = brandName(promo.marca) ?? (promo.store?.trim() || null);
  if (!title && !store) return null;

  const externalId = String(promo.idPromocion ?? promo.id ?? promo.slug ?? '').trim();
  if (!externalId) return null;

  const textParts = [title, store, promo.descripcion, promo.description, promo.legales, ...(promo.details ?? [])];
  const parsedDiscount = parseDiscountFromText(textParts.filter(Boolean) as string[]);
  const pct =
    promo.porcentajeReintegro ??
    promo.porcentaje ??
    parsedDiscount?.percentage ??
    parsePercentage(title) ??
    parsePercentage(promo.descripcion ?? promo.description ?? '') ??
    0;
  if (!parsedDiscount && pct <= 0) return null;

  const discountLabel = parsedDiscount?.label ?? `${pct}% de reintegro`;
  const discountKind = parsedDiscount?.kind ?? 'PERCENTAGE_REFUND';
  const audienceSegments = inferGaliciaAudience(promo);
  const details = [...(promo.details ?? [])];
  if (promo.descripcion || promo.description) details.push(String(promo.descripcion ?? promo.description));
  if (promo.legales) details.push(promo.legales);
  if (audienceSegments.includes('GALICIA_EMINENT')) details.push('Requiere Galicia Eminent');

  const paymentFlow = inferPaymentFlow(promo);
  if (paymentFlow === 'instore') details.push('Compra presencial');
  if (paymentFlow === 'online') details.push('Compra online');

  const provinces =
    promo.provincias?.length ?
      promo.provincias
    : promo.provincia ?
      inferPromotionProvinces({ title: promo.provincia, where: promo.localidad })
    : inferPromotionProvinces({
        title,
        store,
        where: promo.localidad,
        details,
      });

  const validFrom = promo.validFrom ?? promo.fechaDesde ?? null;
  const validTo = promo.validTo ?? promo.fechaHasta ?? null;
  if (validTo && new Date(validTo) < now) return null;

  const sourceUrl =
    promo.url?.trim() ||
    (promo.slug ? `${BUSCADOR_URL}?path=/promocion/${encodeURIComponent(promo.slug)}` : BUSCADOR_URL);

  return {
    externalId,
    title: buildPromoNotes(title || store || 'Beneficio Galicia', store, discountLabel),
    store,
    categoryName: categoryNameOf(promo),
    bankNames: ['Galicia'],
    discountKind,
    discountLabel,
    discountPercentage: pct,
    discountCap: (promo.topeReintegro ?? promo.tope ?? null) || null,
    minPurchaseAmount: parseMinPurchaseAmount(textParts.filter(Boolean) as string[]),
    daysOfWeek: parseGaliciaDays(promo.dias ?? promo.daysOfWeek),
    validFrom,
    validTo,
    sourceUrl,
    imageUrl: promo.imageUrl ?? promo.imagen ?? null,
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
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        Accept: 'application/json, text/plain, */*',
        Origin: 'https://beneficios.galicia.ar',
        Referer: 'https://beneficios.galicia.ar/',
        'Accept-Language': 'es-AR,es;q=0.9',
      },
    });
    if (!res.ok) throw new Error(`${url} returned ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchGaliciaPromos(log: FastifyBaseLogger): Promise<ScrapedPromo[]> {
  const errors: string[] = [];
  for (const url of CANDIDATE_APIS) {
    try {
      const payload = await fetchJson(url);
      const raw = collectPromos(payload);
      const promos = raw.map((p) => normalizeGaliciaPromo(p)).filter((p): p is ScrapedPromo => p != null);
      if (promos.length > 0) {
        log.info({ url, count: promos.length }, 'Galicia benefits fetched');
        const byId = new Map(promos.map((p) => [p.externalId, p]));
        return [...byId.values()];
      }
      errors.push(`${url}: empty`);
    } catch (err) {
      errors.push(`${url}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  throw new Error(`Galicia benefits unreachable (WAF?). Tried: ${errors.join(' | ')}`);
}

export const galiciaSource: PromotionSource = {
  source: 'GALICIA',
  entityName: 'Galicia',
  fetch: fetchGaliciaPromos,
  resolveBanks: (_bankNames, ctx) => ({
    entityId: ctx.defaultEntityId,
    sponsorBank: 'Galicia',
    sponsorBanks: ['Galicia'],
  }),
};
