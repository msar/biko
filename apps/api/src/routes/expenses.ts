import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  createPurchaseWithAllocations,
  ExpenseNotFoundError,
  ExpenseValidationError,
  purchaseInclude,
  rollbackPurchaseCapUsage,
  updatePurchaseWithAllocations,
} from '../services/expense-purchase.js';

const expenseBodySchema = z.object({
  clientId: z.string().min(8).optional(),
  paymentMethodId: z.string(),
  categoryId: z.string(),
  store: z.string().min(1),
  description: z.string().nullish(),
  purchaseDate: z.coerce.date(),
  grossAmount: z.number().positive(),
  installmentsCount: z.number().int().min(1).max(36).default(1),
  applyPromotion: z.boolean().default(true),
  scope: z.enum(['HOUSEHOLD', 'PERSONAL']).default('HOUSEHOLD'),
  myShareAmount: z.number().positive().optional(),
});

const updateExpenseSchema = expenseBodySchema.omit({ clientId: true });

const listQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

function handleExpenseError(error: unknown, reply: { code: (n: number) => { send: (body: unknown) => unknown } }) {
  if (error instanceof ExpenseValidationError) {
    return reply.code(400).send({ error: error.message });
  }
  if (error instanceof ExpenseNotFoundError) {
    return reply.code(404).send({ error: error.message });
  }
  throw error;
}

export default async function expenseRoutes(app: FastifyInstance) {
  app.post('/expenses', { preHandler: [app.authenticate] }, async (request, reply) => {
    const body = expenseBodySchema.parse(request.body);
    const { householdId, userId } = request.user;

    if (body.clientId) {
      const existing = await app.prisma.purchase.findUnique({
        where: { clientId: body.clientId },
        include: purchaseInclude,
      });
      if (existing) return reply.code(200).send(existing);
    }

    try {
      const purchase = await app.prisma.$transaction((tx) =>
        createPurchaseWithAllocations(tx, householdId, userId, body, body.clientId),
      );
      return reply.code(201).send(purchase);
    } catch (error) {
      return handleExpenseError(error, reply);
    }
  });

  app.get('/expenses', { preHandler: [app.authenticate] }, async (request) => {
    const query = listQuerySchema.parse(request.query);
    const where: { householdId: string; purchaseDate?: { gte: Date; lt: Date } } = {
      householdId: request.user.householdId,
    };
    if (query.month) {
      const [y, m] = query.month.split('-').map(Number);
      where.purchaseDate = { gte: new Date(y!, m! - 1, 1), lt: new Date(y!, m!, 1) };
    }
    return app.prisma.purchase.findMany({
      where,
      include: purchaseInclude,
      orderBy: { purchaseDate: 'desc' },
      take: query.limit,
    });
  });

  app.get('/expenses/:id', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const purchase = await app.prisma.purchase.findFirst({
      where: { id, householdId: request.user.householdId },
      include: purchaseInclude,
    });
    if (!purchase) return reply.code(404).send({ error: 'Gasto no encontrado' });
    return purchase;
  });

  app.patch('/expenses/:id', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = updateExpenseSchema.parse(request.body);
    const { householdId, userId } = request.user;

    try {
      const purchase = await app.prisma.$transaction((tx) =>
        updatePurchaseWithAllocations(tx, id, householdId, userId, body),
      );
      return purchase;
    } catch (error) {
      return handleExpenseError(error, reply);
    }
  });

  app.delete('/expenses/:id', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const purchase = await app.prisma.purchase.findFirst({
      where: { id, householdId: request.user.householdId },
      include: { promotion: true },
    });
    if (!purchase) return reply.code(404).send({ error: 'Gasto no encontrado' });

    await app.prisma.$transaction(async (tx) => {
      await rollbackPurchaseCapUsage(tx, purchase);
      await tx.purchase.delete({ where: { id } });
    });
    return reply.code(204).send();
  });
}
