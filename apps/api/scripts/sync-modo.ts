// Entry point para el cron de Railway: sincroniza promos de MODO y termina.
// Uso: npm run sync:modo --workspace @biko/api
import { PrismaClient } from '@prisma/client';
import pino from 'pino';
import { syncModoPromotions } from '../src/services/modo-scraper.js';

const prisma = new PrismaClient();
const log = pino();

try {
  const fresh = process.argv.includes('--fresh');
  const result = await syncModoPromotions(prisma, log, { fresh });
  log.info(result, 'MODO sync done');
  process.exit(0);
} catch (err) {
  log.error(err, 'MODO sync failed');
  process.exit(1);
} finally {
  await prisma.$disconnect();
}
