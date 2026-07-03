import { inferPromotionProvinces, parseDiscountFromText, parseMinPurchaseAmount } from '@biko/shared';
import { Prisma, PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import { buildPromoNotes, parsePercentage, type ScrapedPromo, type SyncResult } from './modo-scraper.js';

// ============================================================
// Scraper de promociones de Naranja X.
//
// La web https://www.naranjax.com/promociones/ consume el BFF
// https://bkn-promotions.naranjax.com/bff-promotions-web (descubierto
// inspeccionando los chunks JS del sitio). Endpoints clave:
//
//   POST /api/binder/filter   — listado paginado de promos
//   GET  /api/aspects/featured — destacadas del home
//
// Cloudflare bloquea requests sin Origin/Referer de naranjax.com.
// Si la API cambia o falla, el sync deja las promos existentes
// (last-good) y registra el error en PromotionSync.
// ============================================================

const SOURCE = 'NARANJA_X';
const API_BASE = 'https://bkn-promotions.naranjax.com/bff-promotions-web';
const PROMOS_URL = 'https://www.naranjax.com/promociones/';
const PAGE_SIZE = 50;
const MAX_PAGES = 200;

const NX_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; BikoHousehold/1.0)',
  Accept: 'application/json',
  'Content-Type': 'application/json',
  Origin: 'https://www.naranjax.com',
  Referer: PROMOS_URL,
};

const NX_CATEGORY_MAP: Record<string, string> = {
  SUPERMERCADOS: 'Supermercado',
  GASTRONOMIA: 'Restaurante',
  MODA_Y_ACCESORIOS: 'Indumentaria',
  SALUD_Y_BIENESTAR: 'Farmacia',
  ELECTRO_Y_TECNOLOGIA: 'Hogar',
  HOGAR_Y_DECO: 'Hogar',
};

const NX_WEEKDAY_LABELS: Record<number, string> = {
  1: 'Los lunes',
  2: 'Los martes',
  3: 'Los miércoles',
  4: 'Los jueves',
  5: 'Los viernes',
  6: 'Los sábados',
  7: 'Los domingos',
};

const NX_MONTH_LABELS = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];

const NX_DAY_MAP: Record<number, string> = {
  1: 'MONDAY',
  2: 'TUESDAY',
  3: 'WEDNESDAY',
  4: 'THURSDAY',
  5: 'FRIDAY',
  6: 'SATURDAY',
  7: 'SUNDAY',
};

interface NxPlan {
  status?: string;
  paymentMethods?: string[];
  ephemeris?: { description?: string; url?: string } | null;
  days?: {
    dateFrom?: string;
    dateTo?: string;
    datesDescription?: string;
    weekdaysApplied?: number[];
    daysApplied?: string[];
    type?: number;
  };
  captureMethods?: Array<{ key?: string; extra?: { name?: string } }>;
  promotionDetails?: { appliesOnline?: boolean };
}

interface NxBinder {
  id: string;
  commerceName?: string;
  title?: string;
  subtitle?: string;
  backgroundImage?: string | null;
  logo?: string | null;
  fullUrl?: string | null;
  url?: string | null;
  plans?: NxPlan[];
  category?: { key?: string; name?: string; subcategory?: { key?: string; name?: string } };
  tags?: Array<{ type?: string; description?: string }>;
  paymentMethods?: string[];
}

interface NxFeatured {
  id: string;
  title?: string;
  clarification?: string;
  validity?: string;
  commerceNameOrCategory?: string;
  link?: string;
  dateFrom?: string;
  dateTo?: string;
  backImageNameDesktop?: string | null;
  paymentMethods?: string[];
}

export function buildNaranjaXSourceUrl(fullUrl: string | null | undefined, urlSlug: string | null | undefined): string {
  const trimmed = fullUrl?.trim();
  if (trimmed?.startsWith('http')) return trimmed;
  const slug = urlSlug?.trim();
  if (slug) return `${PROMOS_URL}${slug.replace(/^\//, '')}`;
  return PROMOS_URL;
}

export function parseNxDate(raw: string | null | undefined, role: 'from' | 'to' = 'from'): string | null {
  if (!raw?.trim()) return null;
  const trimmed = raw.trim();

  const slash = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (slash) {
    const day = Number(slash[1]);
    const month = Number(slash[2]) - 1;
    const year = Number(slash[3]);
    const date = new Date(year, month, day);
    if (Number.isNaN(date.getTime())) return null;
    if (role === 'to') date.setHours(23, 59, 59, 999);
    return date.toISOString();
  }

  const iso = new Date(trimmed);
  if (Number.isNaN(iso.getTime())) return null;
  if (role === 'to') {
    // Timestamps de la API son medianoche Argentina (UTC-3).
    const end = new Date(iso.getTime());
    end.setUTCDate(end.getUTCDate() + 1);
    end.setUTCHours(2, 59, 59, 999);
    return end.toISOString();
  }
  return iso.toISOString();
}

export function parseNxDaysOfWeek(weekdaysApplied: number[] | null | undefined): string[] {
  if (!weekdaysApplied?.length) return [];
  const days = new Set<string>();
  for (const id of weekdaysApplied) {
    const mapped = NX_DAY_MAP[id];
    if (mapped) days.add(mapped);
  }
  return days.size === 0 || days.size === 7 ? [] : [...days];
}

export function mapNxCategory(categoryKey: string | null | undefined): string | null {
  if (!categoryKey) return null;
  return NX_CATEGORY_MAP[categoryKey.toUpperCase()] ?? null;
}

export function parseNxDiscountCap(tags: NxBinder['tags']): number | null {
  for (const tag of tags ?? []) {
    if (tag.type !== 'refund') continue;
    const match = String(tag.description ?? '').match(/\$\s*([\d.]+)/);
    if (match) return Number(match[1]!.replace(/\./g, ''));
  }
  return null;
}

export function currentNxPlans(plans: NxPlan[] | null | undefined): NxPlan[] {
  return (plans ?? []).filter((plan) => (plan.status ?? '').toUpperCase() === 'CURRENT');
}

export function isNaranjaXPromoActive(validFrom: string | null, validTo: string | null, now = new Date()): boolean {
  if (validTo && new Date(validTo) < now) return false;
  if (validFrom && new Date(validFrom) > now) return false;
  return true;
}

export function planScheduleKey(plan: NxPlan): string {
  const weekdays = [...(plan.days?.weekdaysApplied ?? [])].sort((a, b) => a - b).join('');
  const from = plan.days?.dateFrom ?? '';
  const to = plan.days?.dateTo ?? '';
  const applied = [...(plan.days?.daysApplied ?? [])].sort().join(',');
  return `${plan.days?.type ?? 0}|${weekdays}|${from}|${to}|${applied}`;
}

export function uniquePlansBySchedule(plans: NxPlan[]): NxPlan[] {
  const seen = new Map<string, NxPlan>();
  for (const plan of plans) {
    const key = planScheduleKey(plan);
    if (!seen.has(key)) seen.set(key, plan);
  }
  return [...seen.values()];
}

function planExternalId(binderId: string, plan: NxPlan): string {
  const key = planScheduleKey(plan);
  let hash = 0;
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return `${binderId}:${Math.abs(hash).toString(36)}`;
}

function isRestrictivePlanSchedule(plan: NxPlan): boolean {
  if ((plan.days?.daysApplied?.length ?? 0) > 0) return true;
  const weekdays = plan.days?.weekdaysApplied ?? [];
  return weekdays.length > 0 && weekdays.length < 7;
}

function parsePlanDiscount(binder: NxBinder, plan: NxPlan) {
  const titleRaw = binder.title?.trim() ?? '';
  if (isRestrictivePlanSchedule(plan)) {
    return parseDiscountFromText([titleRaw, binder.subtitle ?? '']);
  }

  const installmentMatch = titleRaw.match(/(\d+\s+cuotas?\s+cero\s+inter[eé]s|plan\s+z(?:eta)?\s+cero\s+inter[eé]s)/i);
  if (installmentMatch) {
    const parsed = parseDiscountFromText([installmentMatch[0]!]);
    if (parsed) return parsed;
    return { kind: 'INSTALLMENTS' as const, label: 'Plan Z cero interés', percentage: null };
  }

  return parseDiscountFromText([titleRaw, binder.subtitle ?? '']);
}

/** Solo importamos beneficios con descuento/reintegro; las cuotas sin interés se omiten. */
export function isNxDiscountBenefit(parsed: { kind: string; percentage: number | null }): boolean {
  if (parsed.kind === 'INSTALLMENTS') return false;
  if (parsed.kind === 'PERCENTAGE_REFUND') return (parsed.percentage ?? 0) > 0;
  return true;
}

function formatNxSpecificDates(daysApplied: string[]): string | null {
  if (daysApplied.length === 0) return null;
  const formatted = daysApplied.map((raw) => {
    const match = raw.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!match) return raw;
    const month = NX_MONTH_LABELS[Number(match[2]) - 1] ?? match[2];
    return `${Number(match[1])}/${month}`;
  });
  return `El ${formatted.join(', ')}`;
}

function formatPlanDaysLabel(plan: NxPlan): string | null {
  const specific = formatNxSpecificDates(plan.days?.daysApplied ?? []);
  if (specific) return specific;

  const weekdays = plan.days?.weekdaysApplied ?? [];
  if (weekdays.length > 0 && weekdays.length < 7) {
    return weekdays
      .map((id) => NX_WEEKDAY_LABELS[id])
      .filter(Boolean)
      .join(', ');
  }
  return null;
}

function extractPlanDetails(binder: NxBinder, plan: NxPlan): string[] {
  const details: string[] = [];

  if (binder.subtitle?.trim()) details.push(binder.subtitle.trim());

  for (const tag of binder.tags ?? []) {
    const text = tag.description?.trim();
    if (!text) continue;
    if (tag.type === 'refund' || tag.type === 'accreditation') details.push(text);
  }

  const daysLabel = formatPlanDaysLabel(plan);
  if (daysLabel) details.push(daysLabel);

  const dates = plan.days?.datesDescription?.trim();
  if (dates) details.push(dates);

  const tier = plan.ephemeris?.description?.trim();
  if (tier) details.push(tier);

  if (plan.promotionDetails?.appliesOnline) details.push('Compra online');
  for (const capture of plan.captureMethods ?? []) {
    if (capture.key === 'app') details.push(`App ${capture.extra?.name ?? binder.commerceName ?? ''}`.trim());
  }

  return [...new Set(details.filter(Boolean))];
}

export function normalizeBinderPlan(binder: NxBinder, plan: NxPlan, now = new Date()): ScrapedPromo | null {
  const binderId = binder.id?.trim();
  const store = binder.commerceName?.trim() || null;
  const titleRaw = binder.title?.trim();
  if (!binderId || !titleRaw) return null;

  const parsedDiscount = parsePlanDiscount(binder, plan);
  if (!parsedDiscount || !isNxDiscountBenefit(parsedDiscount)) return null;

  const validFrom = parseNxDate(plan.days?.dateFrom, 'from');
  const validTo = parseNxDate(plan.days?.dateTo, 'to');
  if (!isNaranjaXPromoActive(validFrom, validTo, now)) return null;

  const sourceUrl = buildNaranjaXSourceUrl(binder.fullUrl, binder.url);
  if (!sourceUrl.startsWith('http')) return null;

  const pct =
    parsedDiscount.percentage ??
    parsePercentage(titleRaw) ??
    parsePercentage(binder.subtitle ?? '') ??
    0;

  const details = extractPlanDetails(binder, plan);
  const minPurchaseAmount = parseMinPurchaseAmount([titleRaw, binder.subtitle ?? '', ...details]);
  if (minPurchaseAmount != null) {
    details.push(`Compra mínima ${minPurchaseAmount.toLocaleString('es-AR')}`);
  }

  const discountLabel = parsedDiscount.label;
  const displayTitle =
    parsedDiscount.kind === 'PERCENTAGE_REFUND' || parsedDiscount.kind === 'FIXED_AMOUNT'
      ? buildPromoNotes(parsedDiscount.label, store, parsedDiscount.label)
      : buildPromoNotes(titleRaw, store, discountLabel);

  return {
    externalId: planExternalId(binderId, plan),
    title: displayTitle,
    store,
    categoryName: mapNxCategory(binder.category?.key),
    bankNames: [],
    discountKind: parsedDiscount.kind,
    discountLabel,
    discountPercentage: pct,
    discountCap: parseNxDiscountCap(binder.tags),
    minPurchaseAmount,
    daysOfWeek: parseNxDaysOfWeek(plan.days?.weekdaysApplied),
    validFrom,
    validTo,
    sourceUrl,
    imageUrl: binder.backgroundImage ?? binder.logo ?? null,
    details,
    provinces: inferPromotionProvinces({
      title: titleRaw,
      store,
      where: binder.subtitle,
      tags: binder.category?.name,
    }),
    storesAdherents: false,
    paymentFlow: plan.promotionDetails?.appliesOnline ? 'online' : null,
  };
}

/** Un binder puede tener varios planes (ej. 30% miércoles + Plan Z todos los días). */
export function normalizeBinderPromos(binder: NxBinder, now = new Date()): ScrapedPromo[] {
  const plans = uniquePlansBySchedule(currentNxPlans(binder.plans));
  const promos: ScrapedPromo[] = [];
  for (const plan of plans) {
    const promo = normalizeBinderPlan(binder, plan, now);
    if (promo) promos.push(promo);
  }
  return promos;
}

export function normalizeBinder(binder: NxBinder, now = new Date()): ScrapedPromo | null {
  const promos = normalizeBinderPromos(binder, now);
  return promos.find((promo) => promo.discountKind !== 'INSTALLMENTS') ?? promos[0] ?? null;
}

function isFeaturedPromoLink(link: string | null | undefined): boolean {
  if (!link?.trim()) return false;
  if (/whatsapp\.com|\.pdf$/i.test(link)) return false;
  return /naranjax\.com/i.test(link);
}

export function normalizeFeatured(card: NxFeatured, now = new Date()): ScrapedPromo | null {
  const externalId = card.id?.trim();
  const titleRaw = [card.title, card.clarification].filter(Boolean).join(' — ').trim();
  const store = card.commerceNameOrCategory?.trim() || null;
  const sourceUrl = card.link?.trim();
  if (!externalId || !titleRaw || !isFeaturedPromoLink(sourceUrl)) return null;

  const parsedDiscount = parseDiscountFromText([titleRaw, card.validity ?? '']);
  if (!parsedDiscount || !isNxDiscountBenefit(parsedDiscount)) return null;

  const validFrom = parseNxDate(card.dateFrom ?? null, 'from');
  const validTo = parseNxDate(card.dateTo ?? null, 'to');
  if (!isNaranjaXPromoActive(validFrom, validTo, now)) return null;

  const pct = parsedDiscount.percentage ?? parsePercentage(titleRaw) ?? 0;
  const details = [card.validity, card.clarification].filter((v): v is string => Boolean(v?.trim()));
  const discountLabel = parsedDiscount.label;

  return {
    externalId: `featured:${externalId}`,
    title: buildPromoNotes(titleRaw, store, discountLabel),
    store,
    categoryName: null,
    bankNames: [],
    discountKind: parsedDiscount.kind,
    discountLabel,
    discountPercentage: pct,
    discountCap: null,
    minPurchaseAmount: null,
    daysOfWeek: [],
    validFrom,
    validTo,
    sourceUrl: sourceUrl!,
    imageUrl: card.backImageNameDesktop ?? null,
    details,
    provinces: inferPromotionProvinces({ title: titleRaw, store }),
    storesAdherents: false,
    paymentFlow: /viajes\.naranjax\.com/i.test(sourceUrl!) ? 'online' : null,
  };
}

async function fetchJson<T>(path: string, init?: RequestInit, ms = 30000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...init,
      signal: controller.signal,
      headers: { ...NX_HEADERS, ...init?.headers },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`${path} returned ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchNaranjaXPromos(log: FastifyBaseLogger): Promise<ScrapedPromo[]> {
  const byId = new Map<string, ScrapedPromo>();

  for (let page = 1; page <= MAX_PAGES; page++) {
    const json = await fetchJson<{ data?: NxBinder[]; info?: { page?: number; total?: number; itemsInPage?: number } }>(
      '/api/binder/filter',
      {
        method: 'POST',
        body: JSON.stringify({
          filters: {
            selectedCategoryId: null,
            selectedPaymentMethodIds: [],
            selectedPurchaseModeIds: [],
            selectedDays: [],
          },
          pageOptions: { page, size: PAGE_SIZE },
        }),
      },
    );

    const binders = json.data ?? [];
    if (binders.length === 0) break;

    for (const binder of binders) {
      for (const promo of normalizeBinderPromos(binder)) {
        if (!byId.has(promo.externalId)) byId.set(promo.externalId, promo);
      }
    }

    const itemsInPage = json.info?.itemsInPage ?? binders.length;
    if (itemsInPage < PAGE_SIZE) break;
  }

  const featured = await fetchJson<NxFeatured[]>('/api/aspects/featured', { method: 'GET' });
  for (const card of featured) {
    const promo = normalizeFeatured(card);
    if (promo && !byId.has(promo.externalId)) byId.set(promo.externalId, promo);
  }

  if (byId.size === 0) throw new Error('Naranja X API returned no parseable promos (API changed?)');
  log.info({ count: byId.size }, 'Naranja X promos fetched from binder/filter API');
  return [...byId.values()];
}

export async function persistNaranjaXPromos(
  prisma: PrismaClient,
  scraped: ScrapedPromo[],
  log: FastifyBaseLogger,
): Promise<SyncResult> {
  const entities = await prisma.entity.findMany();
  const entityByName = new Map(entities.map((e) => [e.name.toLowerCase(), e.id]));
  const nxEntityId = entityByName.get('naranja x');
  if (!nxEntityId) throw new Error('Entidad Naranja X no encontrada (falta seed)');

  const categories = await prisma.category.findMany({ where: { householdId: null } });
  const categoryByName = new Map(categories.map((c) => [c.name, c.id]));

  let imported = 0;
  let updated = 0;
  const seenIds: string[] = [];

  for (const promo of scraped) {
    const categoryId = promo.categoryName ? categoryByName.get(promo.categoryName) : undefined;

    const data = {
      entityId: nxEntityId,
      sponsorBank: 'Naranja X',
      sponsorBanks: [],
      store: promo.store,
      paymentMethodType: null,
      daysOfWeek: promo.daysOfWeek as Prisma.PromotionCreatedaysOfWeekInput['set'],
      discountKind: promo.discountKind,
      discountLabel: promo.discountLabel,
      discountPercentage: promo.discountPercentage,
      discountCap: promo.discountCap,
      minPurchaseAmount: promo.minPurchaseAmount,
      validFrom: promo.validFrom ? new Date(promo.validFrom) : null,
      validTo: promo.validTo ? new Date(promo.validTo) : null,
      source: 'SCRAPED' as const,
      sourceUrl: promo.sourceUrl,
      active: true,
      notes: promo.title,
      imageUrl: promo.imageUrl,
      details: promo.details,
      provinces: promo.provinces,
      storesAdherents: promo.storesAdherents,
      paymentFlow: promo.paymentFlow,
    };

    const existing = await prisma.promotion.findUnique({
      where: { externalSource_externalId: { externalSource: SOURCE, externalId: promo.externalId } },
    });

    if (existing) {
      await prisma.promotion.update({
        where: { id: existing.id },
        data: {
          ...data,
          categories: categoryId ? { deleteMany: {}, create: [{ categoryId }] } : { deleteMany: {} },
        },
      });
      updated++;
    } else {
      await prisma.promotion.create({
        data: {
          ...data,
          externalSource: SOURCE,
          externalId: promo.externalId,
          categories: categoryId ? { create: [{ categoryId }] } : undefined,
        },
      });
      imported++;
    }
    seenIds.push(promo.externalId);
  }

  const { count: deactivated } = await prisma.promotion.updateMany({
    where: { externalSource: SOURCE, externalId: { notIn: seenIds }, active: true },
    data: { active: false },
  });

  log.info({ imported, updated, deactivated }, 'Naranja X sync persisted');
  return { imported, updated, deactivated };
}

export async function clearScrapedNaranjaXPromotions(prisma: PrismaClient, log: FastifyBaseLogger): Promise<number> {
  await prisma.purchase.updateMany({
    where: { promotion: { externalSource: SOURCE } },
    data: { promotionId: null },
  });
  const { count } = await prisma.promotion.deleteMany({ where: { externalSource: SOURCE } });
  log.info({ count }, 'Naranja X scraped promos cleared');
  return count;
}

export async function syncNaranjaXPromotions(
  prisma: PrismaClient,
  log: FastifyBaseLogger,
  options: { fresh?: boolean } = {},
): Promise<SyncResult> {
  try {
    let cleared = 0;
    if (options.fresh) cleared = await clearScrapedNaranjaXPromotions(prisma, log);
    const scraped = await fetchNaranjaXPromos(log);
    const result = await persistNaranjaXPromos(prisma, scraped, log);
    await prisma.promotionSync.upsert({
      where: { source: SOURCE },
      create: { source: SOURCE, lastRunAt: new Date(), lastError: null, ...result },
      update: { lastRunAt: new Date(), lastError: null, ...result },
    });
    return { ...result, cleared };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.promotionSync.upsert({
      where: { source: SOURCE },
      create: { source: SOURCE, lastRunAt: new Date(), lastError: message },
      update: { lastRunAt: new Date(), lastError: message },
    });
    throw err;
  }
}
