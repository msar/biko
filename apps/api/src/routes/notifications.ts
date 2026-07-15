import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getVapidPublicKey } from '../services/notifications.js';

export default async function notificationRoutes(app: FastifyInstance) {
  app.get('/notifications', { preHandler: [app.authenticate] }, async (request) => {
    const query = z
      .object({
        unreadOnly: z
          .enum(['true', 'false'])
          .optional()
          .transform((v) => v === 'true'),
        limit: z.coerce.number().int().min(1).max(100).default(40),
      })
      .parse(request.query);

    return app.prisma.notification.findMany({
      where: {
        userId: request.user.userId,
        ...(query.unreadOnly ? { readAt: null } : {}),
      },
      orderBy: [{ readAt: 'asc' }, { createdAt: 'desc' }],
      take: query.limit,
    });
  });

  app.get('/notifications/unread-count', { preHandler: [app.authenticate] }, async (request) => {
    const count = await app.prisma.notification.count({
      where: { userId: request.user.userId, readAt: null },
    });
    return { count };
  });

  app.post('/notifications/:id/read', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const existing = await app.prisma.notification.findFirst({
      where: { id, userId: request.user.userId },
    });
    if (!existing) return reply.code(404).send({ error: 'Notificación no encontrada' });
    return app.prisma.notification.update({
      where: { id },
      data: { readAt: existing.readAt ?? new Date() },
    });
  });

  app.post('/notifications/read-all', { preHandler: [app.authenticate] }, async (request) => {
    await app.prisma.notification.updateMany({
      where: { userId: request.user.userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { ok: true };
  });

  app.get('/notifications/vapid-public-key', { preHandler: [app.authenticate] }, async (_request, reply) => {
    const key = getVapidPublicKey();
    if (!key) return reply.code(503).send({ error: 'Push no configurado (falta VAPID_PUBLIC_KEY)' });
    return { publicKey: key };
  });

  app.post('/notifications/push-subscriptions', { preHandler: [app.authenticate] }, async (request, reply) => {
    const body = z
      .object({
        endpoint: z.string().min(1),
        keys: z.object({
          p256dh: z.string().min(1),
          auth: z.string().min(1),
        }),
        userAgent: z.string().max(300).optional(),
      })
      .parse(request.body);

    const sub = await app.prisma.pushSubscription.upsert({
      where: {
        userId_endpoint: {
          userId: request.user.userId,
          endpoint: body.endpoint,
        },
      },
      create: {
        userId: request.user.userId,
        endpoint: body.endpoint,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
        userAgent: body.userAgent ?? null,
      },
      update: {
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
        userAgent: body.userAgent ?? null,
      },
    });
    return reply.code(201).send(sub);
  });

  app.delete('/notifications/push-subscriptions', { preHandler: [app.authenticate] }, async (request, reply) => {
    const body = z.object({ endpoint: z.string().min(1) }).parse(request.body);
    await app.prisma.pushSubscription.deleteMany({
      where: { userId: request.user.userId, endpoint: body.endpoint },
    });
    return reply.code(204).send();
  });
}
