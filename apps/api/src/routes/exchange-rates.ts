import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ExchangeRateError, getUsdToArsRate } from '../services/exchange-rate.js';

export default async function exchangeRateRoutes(app: FastifyInstance) {
  app.get('/exchange-rates/usd-ars', { preHandler: [app.authenticate] }, async (request, reply) => {
    const query = z
      .object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      })
      .parse(request.query);

    try {
      const result = await getUsdToArsRate(app.prisma, query.date ?? new Date());
      return {
        rate: result.rate,
        source: result.source,
        date: result.date.toISOString().slice(0, 10),
      };
    } catch (err) {
      if (err instanceof ExchangeRateError) {
        return reply.code(503).send({ error: err.message });
      }
      throw err;
    }
  });
}
