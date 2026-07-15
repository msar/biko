import { Prisma } from '@prisma/client';
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ensureDefaultPaymentMethods } from '../services/household-defaults.js';

const createSchema = z.object({
  definitionId: z.string(),
  ownerUserId: z.string().nullish(),
  nickname: z.string().nullish(),
  lastFour: z.string().regex(/^\d{4}$/).nullish(),
  closingDay: z.number().int().min(1).max(31).nullish(),
  dueDay: z.number().int().min(1).max(31).nullish(),
});

const updateSchema = createSchema.partial().omit({ definitionId: true });

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

export default async function paymentMethodRoutes(app: FastifyInstance) {
  app.get('/payment-methods', { preHandler: [app.authenticate] }, async (request) => {
    const householdId = request.user.householdId;
    // Backfill único: hogares creados antes de los medios por defecto los reciben
    // en su próximo fetch, sin re-agregar los que se hayan eliminado luego.
    const household = await app.prisma.household.findUnique({
      where: { id: householdId },
      select: { defaultMethodsAddedAt: true },
    });
    if (household && household.defaultMethodsAddedAt == null) {
      await ensureDefaultPaymentMethods(app.prisma, householdId);
      await app.prisma.household.update({
        where: { id: householdId },
        data: { defaultMethodsAddedAt: new Date() },
      });
    }
    return app.prisma.paymentMethod.findMany({
      where: { householdId },
      include: { definition: { include: { entity: true } }, owner: { select: { id: true, name: true } } },
      orderBy: { id: 'asc' },
    });
  });

  app.post('/payment-methods', { preHandler: [app.authenticate] }, async (request, reply) => {
    const body = createSchema.parse(request.body);
    const definition = await app.prisma.paymentMethodDefinition.findUnique({ where: { id: body.definitionId } });
    if (!definition || !definition.active) {
      return reply.code(400).send({ error: 'Definición de medio de pago inválida' });
    }
    if (definition.type === 'CREDIT_CARD' && (body.closingDay == null || body.dueDay == null)) {
      return reply.code(400).send({ error: 'Las tarjetas de crédito requieren día de cierre y de vencimiento' });
    }
    if (body.ownerUserId) {
      const owner = await app.prisma.user.findFirst({
        where: { id: body.ownerUserId, householdId: request.user.householdId },
      });
      if (!owner) return reply.code(400).send({ error: 'El dueño debe pertenecer al hogar' });
    }
    try {
      const method = await app.prisma.paymentMethod.create({
        data: { ...body, householdId: request.user.householdId },
        include: { definition: { include: { entity: true } }, owner: { select: { id: true, name: true } } },
      });
      return reply.code(201).send(method);
    } catch (error) {
      if (isUniqueViolation(error)) {
        return reply.code(409).send({ error: 'Ya tenés esa tarjeta con esos últimos 4 dígitos' });
      }
      throw error;
    }
  });

  app.put('/payment-methods/:id', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = updateSchema.parse(request.body);
    const existing = await app.prisma.paymentMethod.findFirst({
      where: { id, householdId: request.user.householdId },
      include: { definition: true },
    });
    if (!existing) return reply.code(404).send({ error: 'Medio de pago no encontrado' });

    const closingDay = body.closingDay !== undefined ? body.closingDay : existing.closingDay;
    const dueDay = body.dueDay !== undefined ? body.dueDay : existing.dueDay;
    if (existing.definition.type === 'CREDIT_CARD' && (closingDay == null || dueDay == null)) {
      return reply.code(400).send({ error: 'Las tarjetas de crédito requieren día de cierre y de vencimiento' });
    }
    if (body.ownerUserId) {
      const owner = await app.prisma.user.findFirst({
        where: { id: body.ownerUserId, householdId: request.user.householdId },
      });
      if (!owner) return reply.code(400).send({ error: 'El dueño debe pertenecer al hogar' });
    }

    try {
      return await app.prisma.paymentMethod.update({
        where: { id },
        data: body,
        include: { definition: { include: { entity: true } }, owner: { select: { id: true, name: true } } },
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        return reply.code(409).send({ error: 'Ya tenés esa tarjeta con esos últimos 4 dígitos' });
      }
      throw error;
    }
  });

  app.delete('/payment-methods/:id', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const existing = await app.prisma.paymentMethod.findFirst({
      where: { id, householdId: request.user.householdId },
    });
    if (!existing) return reply.code(404).send({ error: 'Medio de pago no encontrado' });
    const used = await app.prisma.purchase.count({ where: { paymentMethodId: id } });
    if (used > 0) return reply.code(409).send({ error: 'El medio de pago tiene gastos asociados' });
    await app.prisma.paymentMethod.delete({ where: { id } });
    return reply.code(204).send();
  });
}
