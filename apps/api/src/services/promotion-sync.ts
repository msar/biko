import { Prisma, PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';

// ============================================================
// Motor genérico de sync de promociones scrapeadas.
//
// Cada fuente (MODO, Naranja X, Mercado Pago, …) implementa
// PromotionSource con su fetch + (opcional) resolveBanks.
// Persistencia, desactivación de hubieras, clear y upsert de
// PromotionSync viven acá una sola vez.
// ============================================================

export interface ScrapedPromo {
  externalId: string;
  title: string;
  store: string | null;
  categoryName: string | null;
  bankNames: string[];
  discountKind: 'PERCENTAGE_REFUND' | 'INSTALLMENTS' | 'FIXED_AMOUNT' | 'OTHER';
  discountLabel: string;
  discountPercentage: number;
  discountCap: number | null;
  minPurchaseAmount: number | null;
  daysOfWeek: string[];
  validFrom: string | null;
  validTo: string | null;
  sourceUrl: string;
  imageUrl: string | null;
  details: string[];
  provinces: string[];
  storesAdherents: boolean;
  paymentFlow: string | null;
}

export interface SyncResult {
  imported: number;
  updated: number;
  deactivated: number;
  cleared?: number;
}

export interface BankResolverCtx {
  defaultEntityId: string;
  entityByName: Map<string, string>;
}

export interface ResolvedBanks {
  entityId: string;
  sponsorBank: string | null;
  sponsorBanks: string[];
}

export interface PromotionSource {
  /** Clave en Promotion.externalSource / PromotionSync.source */
  source: string;
  /** Nombre de Entity en seed (lowercase match) */
  entityName: string;
  fetch(log: FastifyBaseLogger): Promise<ScrapedPromo[]>;
  resolveBanks?(bankNames: string[], ctx: BankResolverCtx): ResolvedBanks;
}

function defaultResolveBanks(_bankNames: string[], ctx: BankResolverCtx): ResolvedBanks {
  return { entityId: ctx.defaultEntityId, sponsorBank: null, sponsorBanks: [] };
}

export async function persistScrapedPromos(
  prisma: PrismaClient,
  source: PromotionSource,
  scraped: ScrapedPromo[],
  log: FastifyBaseLogger,
): Promise<SyncResult> {
  const entities = await prisma.entity.findMany();
  const entityByName = new Map(entities.map((e) => [e.name.toLowerCase(), e.id]));
  const defaultEntityId = entityByName.get(source.entityName.toLowerCase());
  if (!defaultEntityId) {
    throw new Error(`Entidad "${source.entityName}" no encontrada (falta seed)`);
  }

  const resolveBanks = source.resolveBanks ?? defaultResolveBanks;
  const ctx: BankResolverCtx = { defaultEntityId, entityByName };

  const categories = await prisma.category.findMany({ where: { householdId: null } });
  const categoryByName = new Map(categories.map((c) => [c.name, c.id]));

  let imported = 0;
  let updated = 0;
  const seenIds: string[] = [];

  for (const promo of scraped) {
    const { entityId, sponsorBank, sponsorBanks } = resolveBanks(promo.bankNames, ctx);
    const categoryId = promo.categoryName ? categoryByName.get(promo.categoryName) : undefined;

    const data = {
      entityId,
      sponsorBank,
      sponsorBanks,
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
      where: {
        externalSource_externalId: { externalSource: source.source, externalId: promo.externalId },
      },
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
          externalSource: source.source,
          externalId: promo.externalId,
          categories: categoryId ? { create: [{ categoryId }] } : undefined,
        },
      });
      imported++;
    }
    seenIds.push(promo.externalId);
  }

  const { count: deactivated } = await prisma.promotion.updateMany({
    where: { externalSource: source.source, externalId: { notIn: seenIds }, active: true },
    data: { active: false },
  });

  log.info({ source: source.source, imported, updated, deactivated }, 'Promotion sync persisted');
  return { imported, updated, deactivated };
}

export async function clearScrapedPromotions(
  prisma: PrismaClient,
  source: PromotionSource,
  log: FastifyBaseLogger,
): Promise<number> {
  await prisma.purchase.updateMany({
    where: { promotion: { externalSource: source.source } },
    data: { promotionId: null },
  });
  const { count } = await prisma.promotion.deleteMany({ where: { externalSource: source.source } });
  log.info({ source: source.source, count }, 'Scraped promos cleared');
  return count;
}

export async function syncPromotionSource(
  prisma: PrismaClient,
  source: PromotionSource,
  log: FastifyBaseLogger,
  options: { fresh?: boolean } = {},
): Promise<SyncResult> {
  try {
    let cleared = 0;
    if (options.fresh) cleared = await clearScrapedPromotions(prisma, source, log);
    const scraped = await source.fetch(log);
    const result = await persistScrapedPromos(prisma, source, scraped, log);
    await prisma.promotionSync.upsert({
      where: { source: source.source },
      create: { source: source.source, lastRunAt: new Date(), lastError: null, ...result },
      update: { lastRunAt: new Date(), lastError: null, ...result },
    });
    return { ...result, cleared };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.promotionSync.upsert({
      where: { source: source.source },
      create: { source: source.source, lastRunAt: new Date(), lastError: message },
      update: { lastRunAt: new Date(), lastError: message },
    });
    throw err;
  }
}
