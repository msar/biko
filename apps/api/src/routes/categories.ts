import { isSuperUser } from '@biko/shared';
import { FastifyInstance } from 'fastify';
import { z } from 'zod';

const categorySchema = z.object({
  name: z.string().min(1),
  icon: z.string().nullish(),
  color: z.string().nullish(),
});

const createCategorySchema = categorySchema.extend({
  /** Super-user only: create a global (seed-level) category. */
  global: z.boolean().optional(),
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
    const body = createCategorySchema.parse(request.body);
    const asGlobal = body.global === true;
    if (asGlobal && !isSuperUser(request.user.email)) {
      return reply.code(403).send({ error: 'Acceso denegado' });
    }

    const householdId = asGlobal ? null : request.user.householdId;
    const duplicate = await app.prisma.category.findFirst({
      where: { householdId, name: body.name },
    });
    if (duplicate) {
      return reply.code(409).send({ error: 'Ya existe una categoría con ese nombre' });
    }

    const category = await app.prisma.category.create({
      data: {
        name: body.name,
        icon: body.icon ?? null,
        color: body.color ?? null,
        householdId,
      },
    });
    return reply.code(201).send(category);
  });

  app.put('/categories/:id', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = categorySchema.partial().parse(request.body);
    const existing = await app.prisma.category.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: 'Categoría no encontrada' });

    const isGlobal = existing.householdId === null;
    const isOwnHousehold = existing.householdId === request.user.householdId;
    if (isGlobal) {
      if (!isSuperUser(request.user.email)) {
        return reply.code(403).send({ error: 'Acceso denegado' });
      }
    } else if (!isOwnHousehold) {
      return reply.code(404).send({ error: 'Categoría no encontrada o no editable' });
    }

    if (body.name && body.name !== existing.name) {
      const duplicate = await app.prisma.category.findFirst({
        where: { householdId: existing.householdId, name: body.name, NOT: { id } },
      });
      if (duplicate) {
        return reply.code(409).send({ error: 'Ya existe una categoría con ese nombre' });
      }
    }

    return app.prisma.category.update({ where: { id }, data: body });
  });

  app.delete('/categories/:id', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const existing = await app.prisma.category.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: 'Categoría no encontrada' });

    const isGlobal = existing.householdId === null;
    const isOwnHousehold = existing.householdId === request.user.householdId;
    if (isGlobal) {
      if (!isSuperUser(request.user.email)) {
        return reply.code(403).send({ error: 'Acceso denegado' });
      }
    } else if (!isOwnHousehold) {
      return reply.code(404).send({ error: 'Categoría no encontrada o no editable' });
    }

    const used = await app.prisma.purchase.count({ where: { categoryId: id } });
    if (used > 0) return reply.code(409).send({ error: 'La categoría tiene gastos asociados' });

    const recurring = await app.prisma.recurringPayment.count({ where: { categoryId: id } });
    if (recurring > 0) {
      return reply.code(409).send({ error: 'La categoría tiene pagos recurrentes asociados' });
    }

    await app.prisma.promotionCategory.deleteMany({ where: { categoryId: id } });
    await app.prisma.category.delete({ where: { id } });
    return reply.code(204).send();
  });
}
