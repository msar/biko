import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  completeVariableOccurrence,
  createRecurringPayment,
  occurrenceInclude,
  RecurringNotFoundError,
  RecurringValidationError,
  recurringInclude,
  recurringVisibilityWhere,
  skipOccurrence,
  updateRecurringPayment,
} from '../services/recurring.js';

const createSchema = z.object({
  name: z.string().min(1).max(120),
  categoryId: z.string(),
  paymentMethodId: z.string().nullish(),
  scope: z.enum(['HOUSEHOLD', 'PERSONAL']).default('HOUSEHOLD'),
  dueDay: z.number().int().min(1).max(28),
  amountType: z.enum(['FIXED', 'VARIABLE']),
  amount: z.number().positive().nullish(),
  reminderDaysBefore: z.number().int().min(0).max(14).optional(),
});

const updateSchema = createSchema.partial().extend({
  active: z.boolean().optional(),
});

function handleError(error: unknown, reply: { code: (n: number) => { send: (b: unknown) => unknown } }) {
  if (error instanceof RecurringValidationError) {
    return reply.code(400).send({ error: error.message });
  }
  if (error instanceof RecurringNotFoundError) {
    return reply.code(404).send({ error: error.message });
  }
  throw error;
}

export default async function recurringRoutes(app: FastifyInstance) {
  app.get('/recurring-payments', { preHandler: [app.authenticate] }, async (request) => {
    const { householdId, userId } = request.user;
    return app.prisma.recurringPayment.findMany({
      where: recurringVisibilityWhere(householdId, userId),
      include: recurringInclude,
      orderBy: [{ active: 'desc' }, { nextDueDate: 'asc' }],
    });
  });

  app.post('/recurring-payments', { preHandler: [app.authenticate] }, async (request, reply) => {
    const body = createSchema.parse(request.body);
    const { householdId, userId } = request.user;
    try {
      const created = await createRecurringPayment(app.prisma, householdId, userId, body);
      return reply.code(201).send(created);
    } catch (error) {
      return handleError(error, reply);
    }
  });

  app.patch('/recurring-payments/:id', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = updateSchema.parse(request.body);
    const { householdId, userId } = request.user;
    try {
      return await updateRecurringPayment(app.prisma, householdId, userId, id, body);
    } catch (error) {
      return handleError(error, reply);
    }
  });

  app.delete('/recurring-payments/:id', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const { householdId, userId } = request.user;
    const existing = await app.prisma.recurringPayment.findFirst({
      where: { id, ...recurringVisibilityWhere(householdId, userId) },
    });
    if (!existing) return reply.code(404).send({ error: 'Pago recurrente no encontrado' });
    if (existing.scope === 'PERSONAL' && existing.createdByUserId !== userId) {
      return reply.code(403).send({ error: 'No podés desactivar un recurrente personal ajeno' });
    }
    const updated = await app.prisma.recurringPayment.update({
      where: { id },
      data: { active: false },
      include: recurringInclude,
    });
    return updated;
  });

  app.get('/recurring-payments/occurrences', { preHandler: [app.authenticate] }, async (request) => {
    const query = z
      .object({
        status: z.enum(['PENDING', 'COMPLETED', 'SKIPPED']).optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50),
      })
      .parse(request.query);
    const { householdId, userId } = request.user;
    return app.prisma.recurringOccurrence.findMany({
      where: {
        recurringPayment: recurringVisibilityWhere(householdId, userId),
        ...(query.status ? { status: query.status } : {}),
      },
      include: occurrenceInclude,
      orderBy: [{ dueDate: 'asc' }],
      take: query.limit,
    });
  });

  app.post(
    '/recurring-payments/occurrences/:id/complete',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string() }).parse(request.params);
      const body = z
        .object({
          amount: z.number().positive(),
          paymentMethodId: z.string().nullish(),
        })
        .parse(request.body);
      const { householdId, userId } = request.user;
      try {
        const result = await completeVariableOccurrence(
          app.prisma,
          householdId,
          userId,
          id,
          body.amount,
          body.paymentMethodId,
        );
        return result;
      } catch (error) {
        return handleError(error, reply);
      }
    },
  );

  app.post(
    '/recurring-payments/occurrences/:id/skip',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id } = z.object({ id: z.string() }).parse(request.params);
      const { householdId, userId } = request.user;
      try {
        return await skipOccurrence(app.prisma, householdId, userId, id);
      } catch (error) {
        return handleError(error, reply);
      }
    },
  );
}
