// Entry point para el cron de Railway: sincroniza todas las fuentes de promos y termina.
// Uso: npm run sync:promotions --workspace @biko/api
import { PrismaClient } from '@prisma/client';
import pino from 'pino';
import { syncAllPromotionSources } from '../src/services/promotion-sources.js';

const prisma = new PrismaClient();
const log = pino();

try {
  const fresh = process.argv.includes('--fresh');
  const outcomes = await syncAllPromotionSources(prisma, log, { fresh });
  log.info({ outcomes }, 'Promotion sync done');

  const failures = outcomes.filter((o) => !o.ok);
  if (failures.length === outcomes.length) {
    log.error({ failures }, 'All promotion sources failed');
    process.exit(1);
  }
  if (failures.length > 0) {
    log.warn({ failures }, 'Some promotion sources failed');
  }
  process.exit(0);
} catch (err) {
  log.error(err, 'Promotion sync failed');
  process.exit(1);
} finally {
  await prisma.$disconnect();
}
