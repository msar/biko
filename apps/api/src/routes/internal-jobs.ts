import { FastifyInstance } from 'fastify';
import { runRecurringDailyJob } from '../jobs/recurring-daily.js';

export default async function internalJobRoutes(app: FastifyInstance) {
  app.post('/internal/jobs/recurring', async (request, reply) => {
    const secret = process.env.CRON_SECRET;
    if (!secret) {
      return reply.code(503).send({ error: 'CRON_SECRET no configurado' });
    }
    const header = request.headers['x-cron-secret'] ?? request.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (header !== secret) {
      return reply.code(401).send({ error: 'No autorizado' });
    }
    const result = await runRecurringDailyJob(app.prisma);
    return result;
  });
}
