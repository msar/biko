import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { exportTripToHousehold, previewTripExport } from '../services/trip-export.js';
import {
  closeTrip,
  createTrip,
  createTripExpense,
  createTripHousehold,
  createTripListItem,
  createTripMember,
  deleteTripExpense,
  deleteTripHousehold,
  deleteTripListItem,
  deleteTripMember,
  getTripAccommodation,
  getTripExpense,
  getTripHub,
  getTripInvitePreview,
  joinTripByCode,
  listTripExpenses,
  listTripHouseholds,
  listTripListItems,
  listTripsForUser,
  mintTripInvite,
  settleTrip,
  TripClosedError,
  TripForbiddenError,
  TripNotFoundError,
  TripValidationError,
  updateTrip,
  updateTripExpense,
  updateTripHousehold,
  updateTripListItem,
  updateTripMember,
  upsertTripAccommodation,
  computeTripBalance,
} from '../services/trip.js';

const tripIdParams = z.object({ tripId: z.string().min(1) });
const expenseIdParams = z.object({ tripId: z.string().min(1), expenseId: z.string().min(1) });
const memberIdParams = z.object({ tripId: z.string().min(1), memberId: z.string().min(1) });
const itemIdParams = z.object({ tripId: z.string().min(1), itemId: z.string().min(1) });
const householdIdParams = z.object({ tripId: z.string().min(1), householdId: z.string().min(1) });
const inviteCodeParams = z.object({ code: z.string().min(1) });

const dateInput = z.coerce.date();
const optionalDate = z.coerce.date().nullish();

const createTripSchema = z.object({
  name: z.string().min(1).max(200),
  destination: z.string().max(200).nullish(),
  startDate: optionalDate,
  endDate: optionalDate,
  baseCurrency: z.string().min(1).max(8).optional(),
});

const updateTripSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  destination: z.string().max(200).nullish(),
  startDate: optionalDate,
  endDate: optionalDate,
  status: z.enum(['PLANNING', 'ACTIVE', 'CLOSED']).optional(),
});

const joinSchema = z.object({
  code: z.string().min(1),
  displayName: z.string().min(1).max(100).nullish(),
  claimMemberId: z.string().min(1).nullish(),
});

const createMemberSchema = z.object({
  displayName: z.string().min(1).max(100),
  tripHouseholdId: z.string().min(1).nullish(),
});

const memberPatchSchema = z.object({
  role: z.enum(['ORGANIZER', 'MEMBER']).optional(),
  displayName: z.string().min(1).max(100).optional(),
  tripHouseholdId: z.string().min(1).nullish(),
});

const createHouseholdSchema = z.object({
  name: z.string().min(1).max(100),
  memberIds: z.array(z.string().min(1)).optional(),
});

const householdPatchSchema = z.object({
  name: z.string().min(1).max(100).optional(),
});

const tripCategory = z.enum([
  'ALOJAMIENTO',
  'VUELOS',
  'TRANSPORTE',
  'COMIDA',
  'RESTAURANTES',
  'ACTIVIDADES',
  'OTROS',
]);

const expensePaymentSchema = z.object({
  memberId: z.string().min(1),
  amount: z.number().positive(),
});

const expenseBodySchema = z
  .object({
    amount: z.number().positive(),
    category: tripCategory,
    paidByMemberId: z.string().min(1).optional(),
    payments: z.array(expensePaymentSchema).min(1).optional(),
    note: z.string().max(500).nullish(),
    date: dateInput,
    currency: z.string().min(1).max(8).optional(),
    splitMode: z.enum(['EQUAL', 'ASSIGN', 'AMOUNT', 'SHARES', 'PERCENTAGE']).optional(),
    assignToMemberId: z.string().min(1).nullish(),
    splitValues: z
      .array(z.object({ memberId: z.string().min(1), value: z.number().positive() }))
      .nullish(),
    participantMemberIds: z.array(z.string().min(1)).nullish(),
  })
  .refine((b) => Boolean(b.paidByMemberId) || (b.payments && b.payments.length > 0), {
    message: 'Indicá al menos un pagador',
    path: ['payments'],
  });

const expensePatchSchema = z.object({
  amount: z.number().positive().optional(),
  category: tripCategory.optional(),
  paidByMemberId: z.string().min(1).optional(),
  payments: z.array(expensePaymentSchema).min(1).optional(),
  note: z.string().max(500).nullish(),
  date: dateInput.optional(),
  currency: z.string().min(1).max(8).optional(),
  splitMode: z.enum(['EQUAL', 'ASSIGN', 'AMOUNT', 'SHARES', 'PERCENTAGE']).optional(),
  assignToMemberId: z.string().min(1).nullish(),
  splitValues: z
    .array(z.object({ memberId: z.string().min(1), value: z.number().positive() }))
    .nullish(),
  participantMemberIds: z.array(z.string().min(1)).nullish(),
});

const settleSchema = z.object({
  note: z.string().max(500).nullish(),
  close: z.boolean().optional(),
});

const listItemBodySchema = z.object({
  type: z.enum(['TODO', 'PACK', 'BUY']),
  title: z.string().min(1).max(300),
  notes: z.string().max(1000).nullish(),
  quantity: z.number().int().positive().nullish(),
  assigneeMemberId: z.string().min(1).nullish(),
  dayDate: optionalDate,
});

const listItemPatchSchema = z.object({
  type: z.enum(['TODO', 'PACK', 'BUY']).optional(),
  title: z.string().min(1).max(300).optional(),
  notes: z.string().max(1000).nullish(),
  quantity: z.number().int().positive().nullish(),
  assigneeMemberId: z.string().min(1).nullish(),
  status: z.enum(['PENDING', 'DONE']).optional(),
  dayDate: optionalDate,
});

const optionalTime = z
  .union([
    z.null(),
    z.literal('').transform(() => null),
    z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, 'Hora inválida (HH:mm)')
      .transform((v) => v.slice(0, 5)),
  ])
  .optional();

const optionalAmount = z
  .union([
    z.null(),
    z.literal('').transform(() => null),
    z.number().nonnegative().finite(),
  ])
  .optional();

const accommodationSchema = z.object({
  label: z.string().max(200).nullish(),
  address: z.string().max(2000).nullish(),
  checkIn: optionalDate,
  checkOut: optionalDate,
  checkInTime: optionalTime,
  checkOutTime: optionalTime,
  amount: optionalAmount,
  link: z.string().max(1000).nullish(),
  notes: z.string().max(2000).nullish(),
});

function mapTripError(error: unknown, reply: { code: (n: number) => { send: (b: unknown) => unknown } }) {
  if (error instanceof TripNotFoundError) return reply.code(404).send({ error: error.message });
  if (error instanceof TripForbiddenError) return reply.code(403).send({ error: error.message });
  if (error instanceof TripValidationError || error instanceof TripClosedError) {
    return reply.code(400).send({ error: error.message });
  }
  throw error;
}

export default async function tripRoutes(app: FastifyInstance) {
  app.get('/trips', { preHandler: [app.authenticate] }, async (request) => {
    return listTripsForUser(app.prisma, request.user.userId);
  });

  app.post('/trips', { preHandler: [app.authenticate] }, async (request, reply) => {
    const body = createTripSchema.parse(request.body ?? {});
    try {
      const user = await app.prisma.user.findUniqueOrThrow({
        where: { id: request.user.userId },
        select: { name: true },
      });
      const trip = await createTrip(app.prisma, request.user.userId, body, user.name);
      return reply.code(201).send(trip);
    } catch (error) {
      return mapTripError(error, reply);
    }
  });

  app.get('/trips/invite/:code', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { code } = inviteCodeParams.parse(request.params);
    try {
      return await getTripInvitePreview(app.prisma, code);
    } catch (error) {
      return mapTripError(error, reply);
    }
  });

  app.post('/trips/join', { preHandler: [app.authenticate] }, async (request, reply) => {
    const body = joinSchema.parse(request.body ?? {});
    try {
      const user = await app.prisma.user.findUniqueOrThrow({
        where: { id: request.user.userId },
        select: { name: true },
      });
      const member = await joinTripByCode(app.prisma, request.user.userId, user.name, body.code, {
        displayName: body.displayName,
        claimMemberId: body.claimMemberId,
      });
      return reply.code(201).send({
        memberId: member.id,
        tripId: member.tripId,
        trip: {
          id: member.trip.id,
          name: member.trip.name,
          destination: member.trip.destination,
          status: member.trip.status,
        },
      });
    } catch (error) {
      return mapTripError(error, reply);
    }
  });

  app.get('/trips/:tripId', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { tripId } = tripIdParams.parse(request.params);
    try {
      return await getTripHub(app.prisma, tripId, request.user.userId, request.user.householdId);
    } catch (error) {
      return mapTripError(error, reply);
    }
  });

  app.patch('/trips/:tripId', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { tripId } = tripIdParams.parse(request.params);
    const body = updateTripSchema.parse(request.body ?? {});
    try {
      const trip = await updateTrip(app.prisma, tripId, request.user.userId, body);
      return trip;
    } catch (error) {
      return mapTripError(error, reply);
    }
  });

  app.post('/trips/:tripId/close', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { tripId } = tripIdParams.parse(request.params);
    try {
      return await closeTrip(app.prisma, tripId, request.user.userId);
    } catch (error) {
      return mapTripError(error, reply);
    }
  });

  app.get('/trips/:tripId/members', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { tripId } = tripIdParams.parse(request.params);
    try {
      const hub = await getTripHub(app.prisma, tripId, request.user.userId, request.user.householdId);
      return hub.members;
    } catch (error) {
      return mapTripError(error, reply);
    }
  });

  app.post('/trips/:tripId/members', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { tripId } = tripIdParams.parse(request.params);
    const body = createMemberSchema.parse(request.body ?? {});
    try {
      const member = await createTripMember(app.prisma, tripId, request.user.userId, body);
      return reply.code(201).send(member);
    } catch (error) {
      return mapTripError(error, reply);
    }
  });

  app.delete('/trips/:tripId/members/:memberId', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { tripId, memberId } = memberIdParams.parse(request.params);
    try {
      await deleteTripMember(app.prisma, tripId, request.user.userId, memberId);
      return reply.code(204).send();
    } catch (error) {
      return mapTripError(error, reply);
    }
  });

  app.post('/trips/:tripId/invites', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { tripId } = tripIdParams.parse(request.params);
    try {
      const invite = await mintTripInvite(app.prisma, tripId, request.user.userId);
      return reply.code(201).send(invite);
    } catch (error) {
      return mapTripError(error, reply);
    }
  });

  app.patch('/trips/:tripId/members/:memberId', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { tripId, memberId } = memberIdParams.parse(request.params);
    const body = memberPatchSchema.parse(request.body ?? {});
    try {
      return await updateTripMember(app.prisma, tripId, request.user.userId, memberId, body);
    } catch (error) {
      return mapTripError(error, reply);
    }
  });

  app.get('/trips/:tripId/households', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { tripId } = tripIdParams.parse(request.params);
    try {
      return await listTripHouseholds(app.prisma, tripId, request.user.userId);
    } catch (error) {
      return mapTripError(error, reply);
    }
  });

  app.post('/trips/:tripId/households', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { tripId } = tripIdParams.parse(request.params);
    const body = createHouseholdSchema.parse(request.body ?? {});
    try {
      const household = await createTripHousehold(app.prisma, tripId, request.user.userId, body);
      return reply.code(201).send(household);
    } catch (error) {
      return mapTripError(error, reply);
    }
  });

  app.patch('/trips/:tripId/households/:householdId', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { tripId, householdId } = householdIdParams.parse(request.params);
    const body = householdPatchSchema.parse(request.body ?? {});
    try {
      return await updateTripHousehold(app.prisma, tripId, request.user.userId, householdId, body);
    } catch (error) {
      return mapTripError(error, reply);
    }
  });

  app.delete('/trips/:tripId/households/:householdId', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { tripId, householdId } = householdIdParams.parse(request.params);
    try {
      await deleteTripHousehold(app.prisma, tripId, request.user.userId, householdId);
      return reply.code(204).send();
    } catch (error) {
      return mapTripError(error, reply);
    }
  });

  app.get('/trips/:tripId/expenses', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { tripId } = tripIdParams.parse(request.params);
    try {
      return await listTripExpenses(app.prisma, tripId, request.user.userId);
    } catch (error) {
      return mapTripError(error, reply);
    }
  });

  app.get('/trips/:tripId/expenses/:expenseId', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { tripId, expenseId } = expenseIdParams.parse(request.params);
    try {
      return await getTripExpense(app.prisma, tripId, expenseId, request.user.userId);
    } catch (error) {
      return mapTripError(error, reply);
    }
  });

  app.post('/trips/:tripId/expenses', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { tripId } = tripIdParams.parse(request.params);
    const body = expenseBodySchema.parse(request.body ?? {});
    try {
      const expense = await createTripExpense(app.prisma, tripId, request.user.userId, body);
      return reply.code(201).send(expense);
    } catch (error) {
      return mapTripError(error, reply);
    }
  });

  app.patch('/trips/:tripId/expenses/:expenseId', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { tripId, expenseId } = expenseIdParams.parse(request.params);
    const body = expensePatchSchema.parse(request.body ?? {});
    try {
      return await updateTripExpense(app.prisma, tripId, expenseId, request.user.userId, body);
    } catch (error) {
      return mapTripError(error, reply);
    }
  });

  app.delete('/trips/:tripId/expenses/:expenseId', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { tripId, expenseId } = expenseIdParams.parse(request.params);
    try {
      await deleteTripExpense(app.prisma, tripId, expenseId, request.user.userId);
      return reply.code(204).send();
    } catch (error) {
      return mapTripError(error, reply);
    }
  });

  app.get('/trips/:tripId/balances', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { tripId } = tripIdParams.parse(request.params);
    try {
      await getTripHub(app.prisma, tripId, request.user.userId, request.user.householdId);
      return await computeTripBalance(app.prisma, tripId);
    } catch (error) {
      return mapTripError(error, reply);
    }
  });

  app.get('/trips/:tripId/settle/preview', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { tripId } = tripIdParams.parse(request.params);
    try {
      await getTripHub(app.prisma, tripId, request.user.userId, request.user.householdId);
      return await computeTripBalance(app.prisma, tripId);
    } catch (error) {
      return mapTripError(error, reply);
    }
  });

  app.post('/trips/:tripId/settle', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { tripId } = tripIdParams.parse(request.params);
    const body = settleSchema.parse(request.body ?? {});
    try {
      const balance = await settleTrip(app.prisma, tripId, request.user.userId, body);
      return { balance };
    } catch (error) {
      return mapTripError(error, reply);
    }
  });

  app.get('/trips/:tripId/list-items', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { tripId } = tripIdParams.parse(request.params);
    const query = z
      .object({ type: z.enum(['TODO', 'PACK', 'BUY']).optional() })
      .parse(request.query ?? {});
    try {
      return await listTripListItems(app.prisma, tripId, request.user.userId, query.type);
    } catch (error) {
      return mapTripError(error, reply);
    }
  });

  app.post('/trips/:tripId/list-items', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { tripId } = tripIdParams.parse(request.params);
    const body = listItemBodySchema.parse(request.body ?? {});
    try {
      const item = await createTripListItem(app.prisma, tripId, request.user.userId, body);
      return reply.code(201).send(item);
    } catch (error) {
      return mapTripError(error, reply);
    }
  });

  app.patch('/trips/:tripId/list-items/:itemId', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { tripId, itemId } = itemIdParams.parse(request.params);
    const body = listItemPatchSchema.parse(request.body ?? {});
    try {
      return await updateTripListItem(app.prisma, tripId, itemId, request.user.userId, body);
    } catch (error) {
      return mapTripError(error, reply);
    }
  });

  app.delete('/trips/:tripId/list-items/:itemId', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { tripId, itemId } = itemIdParams.parse(request.params);
    try {
      await deleteTripListItem(app.prisma, tripId, itemId, request.user.userId);
      return reply.code(204).send();
    } catch (error) {
      return mapTripError(error, reply);
    }
  });

  app.get('/trips/:tripId/accommodation', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { tripId } = tripIdParams.parse(request.params);
    try {
      return (await getTripAccommodation(app.prisma, tripId, request.user.userId)) ?? null;
    } catch (error) {
      return mapTripError(error, reply);
    }
  });

  app.put('/trips/:tripId/accommodation', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { tripId } = tripIdParams.parse(request.params);
    const body = accommodationSchema.parse(request.body ?? {});
    try {
      return await upsertTripAccommodation(app.prisma, tripId, request.user.userId, body);
    } catch (error) {
      return mapTripError(error, reply);
    }
  });

  app.get('/trips/:tripId/export/preview', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { tripId } = tripIdParams.parse(request.params);
    try {
      await getTripHub(app.prisma, tripId, request.user.userId, request.user.householdId);
      return await previewTripExport(
        app.prisma,
        tripId,
        request.user.userId,
        request.user.householdId,
      );
    } catch (error) {
      return mapTripError(error, reply);
    }
  });

  app.post('/trips/:tripId/export', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { tripId } = tripIdParams.parse(request.params);
    try {
      const result = await exportTripToHousehold(
        app.prisma,
        tripId,
        request.user.userId,
        request.user.householdId,
      );
      return {
        batchId: result.batch.id,
        purchaseIds: result.purchaseIds,
        netShare: result.preview.netShare,
        categoryMix: result.preview.categoryMix,
      };
    } catch (error) {
      return mapTripError(error, reply);
    }
  });
}
