import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import { mercadoPagoSource } from './mercadopago-scraper.js';
import { modoSource } from './modo-scraper.js';
import { naranjaXSource } from './naranjax-scraper.js';
import { syncPromotionSource, type PromotionSource, type SyncResult } from './promotion-sync.js';

export const PROMOTION_SOURCES: PromotionSource[] = [modoSource, naranjaXSource, mercadoPagoSource];

export type SourceSyncOutcome =
  | { source: string; ok: true; result: SyncResult }
  | { source: string; ok: false; error: string };

export async function syncAllPromotionSources(
  prisma: PrismaClient,
  log: FastifyBaseLogger,
  options: { fresh?: boolean } = {},
): Promise<SourceSyncOutcome[]> {
  const outcomes: SourceSyncOutcome[] = [];

  for (const source of PROMOTION_SOURCES) {
    try {
      const result = await syncPromotionSource(prisma, source, log, options);
      outcomes.push({ source: source.source, ok: true, result });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      log.error({ err, source: source.source }, 'Promotion source sync failed');
      outcomes.push({ source: source.source, ok: false, error });
    }
  }

  return outcomes;
}
