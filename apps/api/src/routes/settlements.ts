import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  computeHouseholdBalance,
  createHouseholdSettlements,
  SettlementValidationError,
} from '../services/household-balance.js';

const createSchema = z.object({
  note: z.string().max(500).nullish(),
});

export default async function settlementRoutes(app: FastifyInstance) {
  app.get('/settlements', { preHandler: [app.authenticate] }, async (request) => {
    const householdId = request.user.householdId;
    const { settlements } = await computeHouseholdBalance(app.prisma, householdId);
    return settlements;
  });

  app.post('/settlements', { preHandler: [app.authenticate] }, async (request, reply) => {
    const body = createSchema.parse(request.body ?? {});
    const householdId = request.user.householdId;
    const userId = request.user.userId;

    try {
      const result = await createHouseholdSettlements(app.prisma, householdId, userId, body.note);
      return {
        settlements: result.settlements,
        balance: {
          perUser: result.perUser,
          transfers: result.transfers,
        },
      };
    } catch (error) {
      if (error instanceof SettlementValidationError) {
        return reply.code(400).send({ error: error.message });
      }
      throw error;
    }
  });
}
