import { FastifyInstance } from 'fastify';
import { z } from 'zod';

const createSchema = z.object({
  definitionId: z.string(),
  ownerUserId: z.string().nullish(),
  nickname: z.string().nullish(),
  lastFour: z.string().regex(/^\d{4}$/).nullish(),
  closingDay: z.number().int().min(1).max(31).nullish(),
  dueDay: z.number().int().min(1).max(31).nullish(),
});

export default async function paymentMethodRoutes(app: FastifyInstance) {
  app.get('/payment-methods', { preHandler: [app.authenticate] }, async (request) => {
    return app.prisma.paymentMethod.findMany({
      where: { householdId: request.user.householdId },
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
    const method = await app.prisma.paymentMethod.create({
      data: { ...body, householdId: request.user.householdId },
      include: { definition: { include: { entity: true } } },
    });
    return reply.code(201).send(method);
  });

  app.put('/payment-methods/:id', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = createSchema.partial().omit({ definitionId: true }).parse(request.body);
    const existing = await app.prisma.paymentMethod.findFirst({
      where: { id, householdId: request.user.householdId },
    });
    if (!existing) return reply.code(404).send({ error: 'Medio de pago no encontrado' });
    return app.prisma.paymentMethod.update({
      where: { id },
      data: body,
      include: { definition: { include: { entity: true } } },
    });
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
