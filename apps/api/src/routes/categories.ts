import { FastifyInstance } from 'fastify';
import { z } from 'zod';

const categorySchema = z.object({
  name: z.string().min(1),
  icon: z.string().nullish(),
  color: z.string().nullish(),
});

export default async function categoryRoutes(app: FastifyInstance) {
  app.get('/categories', { preHandler: [app.authenticate] }, async (request) => {
    // Globales (householdId null, seed) + propias del hogar.
    return app.prisma.category.findMany({
      where: { OR: [{ householdId: null }, { householdId: request.user.householdId }] },
      orderBy: { name: 'asc' },
    });
  });

  app.post('/categories', { preHandler: [app.authenticate] }, async (request, reply) => {
    const body = categorySchema.parse(request.body);
    const category = await app.prisma.category.create({
      data: { ...body, householdId: request.user.householdId },
    });
    return reply.code(201).send(category);
  });

  app.put('/categories/:id', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = categorySchema.partial().parse(request.body);
    const existing = await app.prisma.category.findFirst({
      where: { id, householdId: request.user.householdId },
    });
    if (!existing) return reply.code(404).send({ error: 'Categoría no encontrada o no editable' });
    return app.prisma.category.update({ where: { id }, data: body });
  });

  app.delete('/categories/:id', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const existing = await app.prisma.category.findFirst({
      where: { id, householdId: request.user.householdId },
    });
    if (!existing) return reply.code(404).send({ error: 'Categoría no encontrada o no editable' });
    const used = await app.prisma.purchase.count({ where: { categoryId: id } });
    if (used > 0) return reply.code(409).send({ error: 'La categoría tiene gastos asociados' });
    await app.prisma.category.delete({ where: { id } });
    return reply.code(204).send();
  });
}
