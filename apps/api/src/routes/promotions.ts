import { getCategorySchedule, getWeeklyRecommendations, householdHasMatchingPaymentMethod, filterHiddenWeeklyGroups, WEEKLY_ESSENTIAL_CATEGORY_NAMES } from '@biko/shared';
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { syncMercadoPagoPromotions } from '../services/mercadopago-scraper.js';
import { syncModoPromotions } from '../services/modo-scraper.js';
import { syncNaranjaXPromotions } from '../services/naranjax-scraper.js';
import {
  PROMOTION_INCLUDE,
  suggestForExpense,
  suggestPromotion,
  toPromotionInput,
} from '../services/promotion-suggestion.js';

const dayEnum = z.enum(['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY']);

const promotionSchema = z.object({
  entityId: z.string(),
  store: z.string().nullish(),
  paymentMethodType: z.enum(['DEBIT_CARD', 'CREDIT_CARD', 'WALLET', 'CASH', 'BANK_TRANSFER']).nullish(),
  cardNetwork: z.enum(['VISA', 'MASTERCARD', 'AMEX', 'CABAL', 'NONE']).nullish(),
  daysOfWeek: z.array(dayEnum).default([]),
  categoryIds: z.array(z.string()).default([]),
  discountPercentage: z.number().positive().max(100),
  discountCap: z.number().positive().nullish(),
  minPurchaseAmount: z.number().positive().nullish(),
  validFrom: z.coerce.date().nullish(),
  validTo: z.coerce.date().nullish(),
  active: z.boolean().default(true),
  notes: z.string().nullish(),
  sourceUrl: z.string().url().nullish(),
});

const suggestQuerySchema = z.object({
  date: z.coerce.date().optional(),
  store: z.string().optional(),
  paymentMethodId: z.string(),
  amount: z.coerce.number().positive().optional(),
  categoryId: z.string().optional(),
});

const suggestExpenseQuerySchema = z.object({
  date: z.coerce.date().optional(),
  store: z.string().optional(),
  amount: z.coerce.number().positive().optional(),
  categoryId: z.string().optional(),
});

const FULL_INCLUDE = {
  entity: true,
  categories: { select: { categoryId: true } },
} as const;

async function householdMethodsForRecommender(app: FastifyInstance, householdId: string) {
  const methods = await app.prisma.paymentMethod.findMany({
    where: { householdId },
    include: { definition: { include: { entity: true } } },
  });
  return methods.map((m) => ({
    id: m.id,
    entityId: m.definition.entityId,
    entityName: m.definition.entity?.name ?? m.definition.name,
    type: m.definition.type,
    network: m.definition.network,
  }));
}

async function householdContext(app: FastifyInstance, householdId: string) {
  const [methods, household] = await Promise.all([
    householdMethodsForRecommender(app, householdId),
    app.prisma.household.findUniqueOrThrow({ where: { id: householdId }, select: { province: true } }),
  ]);
  return { methods, province: household.province };
}

export default async function promotionRoutes(app: FastifyInstance) {
  app.get('/promotions', { preHandler: [app.authenticate] }, async (request) => {
    const { methods } = await householdContext(app, request.user.householdId);
    const promos = await app.prisma.promotion.findMany({
      include: FULL_INCLUDE,
      orderBy: [{ active: 'desc' }, { entity: { name: 'asc' } }],
    });
    return promos
      .filter((p) =>
        householdHasMatchingPaymentMethod(methods, {
          entityId: p.entityId,
          sponsorBank: p.sponsorBank,
          sponsorBanks: p.sponsorBanks,
          paymentMethodType: p.paymentMethodType,
          cardNetwork: p.cardNetwork,
        }),
      )
      .map((p) => ({ ...p, categoryIds: p.categories.map((c) => c.categoryId) }));
  });

  app.post('/promotions', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { categoryIds, ...body } = promotionSchema.parse(request.body);
    const entity = await app.prisma.entity.findUnique({ where: { id: body.entityId } });
    if (!entity) return reply.code(400).send({ error: 'Entidad inválida' });
    const promo = await app.prisma.promotion.create({
      data: { ...body, categories: { create: categoryIds.map((categoryId) => ({ categoryId })) } },
      include: FULL_INCLUDE,
    });
    return reply.code(201).send({ ...promo, categoryIds: promo.categories.map((c) => c.categoryId) });
  });

  app.put('/promotions/:id', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const { categoryIds, ...body } = promotionSchema.partial().parse(request.body);
    const existing = await app.prisma.promotion.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: 'Promoción no encontrada' });
    const promo = await app.prisma.promotion.update({
      where: { id },
      data: {
        ...body,
        ...(categoryIds
          ? { categories: { deleteMany: {}, create: categoryIds.map((categoryId) => ({ categoryId })) } }
          : {}),
      },
      include: FULL_INCLUDE,
    });
    return { ...promo, categoryIds: promo.categories.map((c) => c.categoryId) };
  });

  app.delete('/promotions/:id', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const existing = await app.prisma.promotion.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: 'Promoción no encontrada' });
    // Soft-delete: las compras históricas referencian la promo (snapshot).
    return app.prisma.promotion.update({ where: { id }, data: { active: false } });
  });

  // Calendario semanal: solo rubros de compras frecuentes del hogar (Mi semana).
  app.get('/promotions/weekly', { preHandler: [app.authenticate] }, async (request) => {
    const { methods, province } = await householdContext(app, request.user.householdId);
    const [promos, essentialCategories, hidden] = await Promise.all([
      app.prisma.promotion.findMany({ where: { active: true }, include: PROMOTION_INCLUDE }),
      app.prisma.category.findMany({
        where: { householdId: null, name: { in: [...WEEKLY_ESSENTIAL_CATEGORY_NAMES] } },
        select: { id: true },
      }),
      app.prisma.householdHiddenWeeklyPromo.findMany({
        where: { householdId: request.user.householdId },
        select: { groupKey: true },
      }),
    ]);
    const days = getWeeklyRecommendations(
      methods,
      promos.map(toPromotionInput),
      new Date(),
      { mode: 'any', ids: essentialCategories.map((c) => c.id) },
      province,
      { essentialsOnly: true, banksOnly: true },
    );
    return filterHiddenWeeklyGroups(days, hidden.map((h) => h.groupKey));
  });

  app.get('/promotions/weekly/hidden', { preHandler: [app.authenticate] }, async (request) => {
    return app.prisma.householdHiddenWeeklyPromo.findMany({
      where: { householdId: request.user.householdId },
      orderBy: { label: 'asc' },
    });
  });

  app.post('/promotions/weekly/hidden', { preHandler: [app.authenticate] }, async (request, reply) => {
    const body = z.object({ groupKey: z.string().min(1), label: z.string().min(1) }).parse(request.body);
    const row = await app.prisma.householdHiddenWeeklyPromo.upsert({
      where: {
        householdId_groupKey: { householdId: request.user.householdId, groupKey: body.groupKey },
      },
      create: { householdId: request.user.householdId, groupKey: body.groupKey, label: body.label },
      update: { label: body.label },
    });
    return reply.code(201).send(row);
  });

  app.delete('/promotions/weekly/hidden/:groupKey', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { groupKey } = z.object({ groupKey: z.string().min(1) }).parse(request.params);
    const decoded = decodeURIComponent(groupKey);
    const existing = await app.prisma.householdHiddenWeeklyPromo.findUnique({
      where: { householdId_groupKey: { householdId: request.user.householdId, groupKey: decoded } },
    });
    if (!existing) return reply.code(404).send({ error: 'Promo oculta no encontrada' });
    await app.prisma.householdHiddenWeeklyPromo.delete({
      where: { householdId_groupKey: { householdId: request.user.householdId, groupKey: decoded } },
    });
    return reply.code(204).send();
  });

  // "¿Cuándo conviene ir?" para una categoría (ej: Combustible).
  app.get('/promotions/by-category/:categoryId', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { categoryId } = z.object({ categoryId: z.string() }).parse(request.params);
    const category = await app.prisma.category.findFirst({
      where: { id: categoryId, OR: [{ householdId: null }, { householdId: request.user.householdId }] },
    });
    if (!category) return reply.code(404).send({ error: 'Categoría no encontrada' });
    const { methods, province } = await householdContext(app, request.user.householdId);
    const promos = await app.prisma.promotion.findMany({ where: { active: true }, include: PROMOTION_INCLUDE });
    return {
      category: { id: category.id, name: category.name, icon: category.icon },
      days: getCategorySchedule(categoryId, methods, promos.map(toPromotionInput), new Date(), province),
    };
  });

  // Sugerencia puntual al cargar un gasto (con tope mensual ya descontado).
  app.get('/promotions/suggest', { preHandler: [app.authenticate] }, async (request, reply) => {
    const query = suggestQuerySchema.parse(request.query);
    const method = await app.prisma.paymentMethod.findFirst({
      where: { id: query.paymentMethodId, householdId: request.user.householdId },
      include: { definition: true },
    });
    if (!method) return reply.code(400).send({ error: 'Medio de pago inválido' });

    const suggestion = await suggestPromotion(app.prisma, {
      householdId: request.user.householdId,
      date: query.date ?? new Date(),
      store: query.store ?? null,
      grossAmount: query.amount ?? null,
      categoryId: query.categoryId ?? null,
      paymentMethod: {
        entityId: method.definition.entityId,
        entityName: method.definition.entity?.name ?? method.definition.name,
        type: method.definition.type,
        network: method.definition.network,
      },
      householdProvince: (
        await app.prisma.household.findUnique({
          where: { id: request.user.householdId },
          select: { province: true },
        })
      )?.province,
    });
    return { suggestion };
  });

  // "¿Con qué pago?": mejor promo entre TODOS los medios de pago del hogar.
  app.get('/promotions/suggest-expense', { preHandler: [app.authenticate] }, async (request) => {
    const query = suggestExpenseQuerySchema.parse(request.query);
    return suggestForExpense(app.prisma, {
      householdId: request.user.householdId,
      date: query.date ?? new Date(),
      store: query.store ?? null,
      grossAmount: query.amount ?? null,
      categoryId: query.categoryId ?? null,
    });
  });

  // Scraping de promos (solo super usuario; en Railway también corre por cron).
  const superUserOnly = [app.authenticate, app.requireSuperUser];

  app.post('/promotions/sync/modo', { preHandler: superUserOnly }, async (request, reply) => {
    const fresh = z.object({ fresh: z.coerce.boolean().optional() }).parse(request.query).fresh ?? false;
    try {
      const result = await syncModoPromotions(app.prisma, app.log, { fresh });
      return result;
    } catch (err) {
      app.log.error(err, 'MODO sync failed');
      return reply.code(502).send({ error: 'No se pudo sincronizar con MODO' });
    }
  });

  app.post('/promotions/sync/mercadopago', { preHandler: superUserOnly }, async (request, reply) => {
    const fresh = z.object({ fresh: z.coerce.boolean().optional() }).parse(request.query).fresh ?? false;
    try {
      const result = await syncMercadoPagoPromotions(app.prisma, app.log, { fresh });
      return result;
    } catch (err) {
      app.log.error(err, 'Mercado Pago sync failed');
      return reply.code(502).send({ error: 'No se pudo sincronizar con Mercado Pago' });
    }
  });

  app.post('/promotions/sync/naranjax', { preHandler: superUserOnly }, async (request, reply) => {
    const fresh = z.object({ fresh: z.coerce.boolean().optional() }).parse(request.query).fresh ?? false;
    try {
      const result = await syncNaranjaXPromotions(app.prisma, app.log, { fresh });
      return result;
    } catch (err) {
      app.log.error(err, 'Naranja X sync failed');
      return reply.code(502).send({ error: 'No se pudo sincronizar con Naranja X' });
    }
  });

  app.get('/promotions/sync/status', { preHandler: superUserOnly }, async () => {
    const rows = await app.prisma.promotionSync.findMany();
    return rows;
  });
}
