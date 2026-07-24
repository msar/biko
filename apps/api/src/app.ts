import cors from '@fastify/cors';
import Fastify from 'fastify';
import { ZodError } from 'zod';
import authPlugin from './plugins/auth.js';
import prismaPlugin from './plugins/prisma.js';
import authRoutes from './routes/auth.js';
import catalogRoutes from './routes/catalog.js';
import categoryRoutes from './routes/categories.js';
import dashboardRoutes from './routes/dashboard.js';
import expenseRoutes from './routes/expenses.js';
import paymentMethodRoutes from './routes/payment-methods.js';
import promotionRoutes from './routes/promotions.js';
import recurringRoutes from './routes/recurring.js';
import notificationRoutes from './routes/notifications.js';
import internalJobRoutes from './routes/internal-jobs.js';
import statementImportRoutes from './routes/statement-imports.js';
import exchangeRateRoutes from './routes/exchange-rates.js';
import debtRoutes from './routes/debts.js';

export async function buildApp() {
  const app = Fastify({ logger: true });

  await app.register(cors, {
    origin: process.env.CORS_ORIGIN?.split(',') ?? true,
  });
  await app.register(prismaPlugin);
  await app.register(authPlugin);

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: 'Datos inválidos', details: error.flatten() });
    }
    app.log.error(error);
    const statusCode = (error as { statusCode?: unknown }).statusCode;
    const status = typeof statusCode === 'number' ? statusCode : 500;
    const message = error instanceof Error ? error.message : 'Error interno';
    return reply.code(status).send({ error: status === 500 ? 'Error interno' : message });
  });

  app.get('/health', async () => ({ status: 'ok' }));

  await app.register(authRoutes);
  await app.register(catalogRoutes);
  await app.register(categoryRoutes);
  await app.register(paymentMethodRoutes);
  await app.register(promotionRoutes);
  await app.register(expenseRoutes);
  await app.register(dashboardRoutes);
  await app.register(recurringRoutes);
  await app.register(notificationRoutes);
  await app.register(internalJobRoutes);
  await app.register(statementImportRoutes);
  await app.register(exchangeRateRoutes);
  await app.register(debtRoutes);

  return app;
}
