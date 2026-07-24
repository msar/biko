import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  createContact,
  createDebt,
  DebtNotFoundError,
  DebtValidationError,
  deleteContact,
  getDebtSummary,
  listContacts,
  listDebts,
  markDebtInstallmentPaid,
  markDebtInstallmentUnpaid,
  updateContact,
  updateDebt,
} from '../services/debt.js';

const newContactSchema = z.object({
  name: z.string().min(1).max(120),
  phone: z.string().max(40).nullish(),
  email: z.string().email().max(160).nullish(),
});

const createContactSchema = newContactSchema;

const updateContactSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  phone: z.string().max(40).nullish(),
  email: z.string().email().max(160).nullish(),
});

const createDebtSchema = z
  .object({
    contactId: z.string().optional(),
    newContact: newContactSchema.optional(),
    direction: z.enum(['OWED_TO_ME', 'I_OWE']),
    title: z.string().min(1).max(200),
    notes: z.string().max(2000).nullish(),
    totalAmount: z.number().positive(),
    currency: z.enum(['ARS', 'USD']).default('ARS'),
    installmentsCount: z.number().int().min(1).max(36).default(1),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .refine((b) => Boolean(b.contactId) || Boolean(b.newContact), {
    message: 'Indicá contactId o newContact',
  });

const updateDebtSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  notes: z.string().max(2000).nullish(),
});

function handleError(error: unknown, reply: { code: (n: number) => { send: (b: unknown) => unknown } }) {
  if (error instanceof DebtValidationError) {
    return reply.code(400).send({ error: error.message });
  }
  if (error instanceof DebtNotFoundError) {
    return reply.code(404).send({ error: error.message });
  }
  throw error;
}

export default async function debtRoutes(app: FastifyInstance) {
  app.get('/contacts', { preHandler: [app.authenticate] }, async (request) => {
    return listContacts(app.prisma, request.user.householdId);
  });

  app.post('/contacts', { preHandler: [app.authenticate] }, async (request, reply) => {
    const body = createContactSchema.parse(request.body);
    try {
      const created = await createContact(app.prisma, request.user.householdId, body);
      return reply.code(201).send(created);
    } catch (error) {
      return handleError(error, reply);
    }
  });

  app.patch('/contacts/:id', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = updateContactSchema.parse(request.body);
    try {
      return await updateContact(app.prisma, request.user.householdId, id, body);
    } catch (error) {
      return handleError(error, reply);
    }
  });

  app.delete('/contacts/:id', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    try {
      return await deleteContact(app.prisma, request.user.householdId, id);
    } catch (error) {
      return handleError(error, reply);
    }
  });

  app.get('/debts/summary', { preHandler: [app.authenticate] }, async (request) => {
    const query = z
      .object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional() })
      .parse(request.query);
    return getDebtSummary(app.prisma, request.user.householdId, query.month);
  });

  app.get('/debts', { preHandler: [app.authenticate] }, async (request) => {
    const query = z
      .object({
        status: z.enum(['OPEN', 'SETTLED']).optional(),
        contactId: z.string().optional(),
      })
      .parse(request.query);
    return listDebts(app.prisma, request.user.householdId, query);
  });

  app.post('/debts', { preHandler: [app.authenticate] }, async (request, reply) => {
    const body = createDebtSchema.parse(request.body);
    const { householdId, userId } = request.user;
    try {
      const created = await createDebt(app.prisma, householdId, userId, {
        contactId: body.contactId,
        newContact: body.newContact ?? undefined,
        direction: body.direction,
        title: body.title,
        notes: body.notes,
        totalAmount: body.totalAmount,
        currency: body.currency,
        installmentsCount: body.installmentsCount,
        startDate: new Date(`${body.startDate}T12:00:00.000Z`),
      });
      return reply.code(201).send(created);
    } catch (error) {
      return handleError(error, reply);
    }
  });

  app.patch('/debts/:id', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = updateDebtSchema.parse(request.body);
    try {
      return await updateDebt(app.prisma, request.user.householdId, id, body);
    } catch (error) {
      return handleError(error, reply);
    }
  });

  app.post(
    '/debts/:id/installments/:number/pay',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const params = z
        .object({ id: z.string(), number: z.coerce.number().int().min(1).max(36) })
        .parse(request.params);
      const body = z
        .object({ paidDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() })
        .parse(request.body ?? {});
      try {
        return await markDebtInstallmentPaid(
          app.prisma,
          request.user.householdId,
          params.id,
          params.number,
          body.paidDate ? new Date(`${body.paidDate}T12:00:00.000Z`) : undefined,
        );
      } catch (error) {
        return handleError(error, reply);
      }
    },
  );

  app.post(
    '/debts/:id/installments/:number/unpay',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const params = z
        .object({ id: z.string(), number: z.coerce.number().int().min(1).max(36) })
        .parse(request.params);
      try {
        return await markDebtInstallmentUnpaid(
          app.prisma,
          request.user.householdId,
          params.id,
          params.number,
        );
      } catch (error) {
        return handleError(error, reply);
      }
    },
  );
}
