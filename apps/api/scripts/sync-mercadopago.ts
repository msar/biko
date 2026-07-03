// Entry point para cron de Railway: sincroniza promos de Mercado Pago y termina.
// Uso: npm run sync:mercadopago --workspace @biko/api
import { PrismaClient } from '@prisma/client';
import pino from 'pino';
import { syncMercadoPagoPromotions } from '../src/services/mercadopago-scraper.js';

const prisma = new PrismaClient();
const log = pino();

try {
  const fresh = process.argv.includes('--fresh');
  const result = await syncMercadoPagoPromotions(prisma, log, { fresh });
  log.info(result, 'Mercado Pago sync done');
  process.exit(0);
} catch (err) {
  log.error(err, 'Mercado Pago sync failed');
  process.exit(1);
} finally {
  await prisma.$disconnect();
}
