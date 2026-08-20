import { isSuperUser } from '@biko/shared';
import bcrypt from 'bcryptjs';
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { tripActorFromRequest } from '../lib/trip-auth.js';
import {
  isTripGuestPayload,
  jwtHouseholdId,
  type JwtPayload,
  type JwtUserPayload,
} from '../plugins/auth.js';
import { exportTripToHousehold, previewTripExport } from '../services/trip-export.js';
import {
  applyPackingSuggestions,
  getTripForecast,
  TripForecastError,
} from '../services/trip-forecast.js';
import {
  createTripItineraryItem,
  deleteTripItineraryItem,
  listTripItinerary,
  updateTripItineraryItem,
} from '../services/trip-itinerary.js';
import {
  closeTrip,
  computeTripBalance,
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
  getTripListItem,
  joinTripByCode,
  linkTripMemberToUser,
  listTripExpenses,
  listTripHouseholds,
  listTripListItemActivities,
  listTripListItems,
  listTripsForUser,
  mergeTripMember,
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
} from '../services/trip.js';

const tripIdParams = z.object({ tripId: z.string().min(1) });
const expenseIdParams = z.object({ tripId: z.string().min(1), expenseId: z.string().min(1) });
const memberIdParams = z.object({ tripId: z.string().min(1), memberId: z.string().min(1) });
const itemIdParams = z.object({ tripId: z.string().min(1), itemId: z.string().min(1) });
const householdIdParams = z.object({ tripId: z.string().min(1), householdId: z.string().min(1) });
const inviteCodeParams = z.object({ code: z.string().min(1) });

/** YYYY-MM-DD calendar dates (encoded in destination timezone by the service). */
const dateInput = z.string().transform((v, ctx) => {
  const m = String(v).trim().match(/^(\d{4}-\d{2}-\d{2})/);
  if (!m) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Fecha inválida' });
    return z.NEVER;
  }
  return m[1]!;
});

const optionalDate = z
  .union([z.string(), z.null()])
  .nullish()
  .transform((v, ctx) => {
    if (v === undefined) return undefined;
    if (v === null || v === '') return null;
    const m = String(v).trim().match(/^(\d{4}-\d{2}-\d{2})/);
    if (!m) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Fecha inválida' });
      return z.NEVER;
    }
    return m[1]!;
  });

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

const linkAccountSchema = z.object({
  mode: z.enum(['register', 'login']),
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1).max(100).optional(),
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

const mergeMemberSchema = z.object({
  intoMemberId: z.string().min(1),
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
  memberId: z.string().min(1, 'Indicá un pagador'),
  amount: z.number({ invalid_type_error: 'Monto de pago inválido' }).positive('El monto pagado debe ser mayor a 0'),
});

const splitValueEntrySchema = z.object({
  memberId: z.string().min(1, 'Falta un viajero en el reparto'),
  // 0 is valid (p.ej. 100% a uno, 0% al resto); allocation rejects negatives.
  value: z
    .number({ invalid_type_error: 'Valor de reparto inválido' })
    .finite('Valor de reparto inválido')
    .nonnegative('Los valores de reparto no pueden ser negativos'),
});

const expenseBodySchema = z
  .object({
    amount: z.number({ invalid_type_error: 'Monto inválido' }).positive('El monto debe ser mayor a 0'),
    category: tripCategory,
    paidByMemberId: z.string().min(1).optional(),
    payments: z.array(expensePaymentSchema).min(1).optional(),
    note: z.string().max(500).nullish(),
    date: dateInput,
    currency: z.string().min(1).max(8).optional(),
    splitMode: z.enum(['EQUAL', 'ASSIGN', 'AMOUNT', 'SHARES', 'PERCENTAGE']).optional(),
    assignToMemberId: z.string().min(1).nullish(),
    splitValues: z.array(splitValueEntrySchema).nullish(),
    participantMemberIds: z.array(z.string().min(1)).nullish(),
  })
  .refine((b) => Boolean(b.paidByMemberId) || (b.payments && b.payments.length > 0), {
    message: 'Indicá al menos un pagador',
    path: ['payments'],
  });

const expensePatchSchema = z.object({
  amount: z.number({ invalid_type_error: 'Monto inválido' }).positive('El monto debe ser mayor a 0').optional(),
  category: tripCategory.optional(),
  paidByMemberId: z.string().min(1).optional(),
  payments: z.array(expensePaymentSchema).min(1).optional(),
  note: z.string().max(500).nullish(),
  date: dateInput.optional(),
  currency: z.string().min(1).max(8).optional(),
  splitMode: z.enum(['EQUAL', 'ASSIGN', 'AMOUNT', 'SHARES', 'PERCENTAGE']).optional(),
  assignToMemberId: z.string().min(1).nullish(),
  splitValues: z.array(splitValueEntrySchema).nullish(),
  participantMemberIds: z.array(z.string().min(1)).nullish(),
});

const settleSchema = z.object({
  note: z.string().max(500).nullish(),
  close: z.boolean().optional(),
});

/** Nested packing checklists can grow past a short free-text note. */
const LIST_ITEM_NOTES_MAX = 10_000;

const listItemBodySchema = z.object({
  type: z.enum(['TODO', 'PACK', 'BUY']),
  title: z.string().min(1).max(300),
  notes: z.string().max(LIST_ITEM_NOTES_MAX).nullish(),
  quantity: z.number().int().positive().nullish(),
  assignToAll: z.boolean().optional(),
  assigneeMemberIds: z.array(z.string().min(1)).optional(),
  /** @deprecated use assigneeMemberIds */
  assigneeMemberId: z.string().min(1).nullish(),
  dayDate: optionalDate,
});

const listItemPatchSchema = z.object({
  type: z.enum(['TODO', 'PACK', 'BUY']).optional(),
  title: z.string().min(1).max(300).optional(),
  notes: z.string().max(LIST_ITEM_NOTES_MAX).nullish(),
  quantity: z.number().int().positive().nullish(),
  assignToAll: z.boolean().optional(),
  assigneeMemberIds: z.array(z.string().min(1)).optional(),
  /** @deprecated use assigneeMemberIds */
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

const itineraryCreateSchema = z.object({
  type: z.enum(['MEAL', 'RESERVATION', 'ACTIVITY']),
  dayDate: dateInput,
  startTime: optionalTime,
  endTime: optionalTime,
  title: z.string().max(300).nullish(),
  notes: z.string().max(2000).nullish(),
  sortOrder: z.number().int().optional(),
  mealSlot: z.enum(['BREAKFAST', 'LUNCH', 'DINNER']).nullish(),
  menu: z.string().max(4000).nullish(),
  inChargeMemberId: z.string().min(1).nullish(),
  placeName: z.string().max(300).nullish(),
  address: z.string().max(2000).nullish(),
  link: z.string().max(1000).nullish(),
  mealItemId: z.string().min(1).nullish(),
  amount: optionalAmount,
});

const itineraryPatchSchema = z.object({
  dayDate: optionalDate,
  startTime: optionalTime,
  endTime: optionalTime,
  title: z.string().max(300).nullish(),
  notes: z.string().max(2000).nullish(),
  sortOrder: z.number().int().optional(),
  mealSlot: z.enum(['BREAKFAST', 'LUNCH', 'DINNER']).nullish(),
  menu: z.string().max(4000).nullish(),
  inChargeMemberId: z.string().min(1).nullish(),
  placeName: z.string().max(300).nullish(),
  address: z.string().max(2000).nullish(),
  link: z.string().max(1000).nullish(),
  mealItemId: z.string().min(1).nullish(),
  amount: optionalAmount,
});

const itineraryQuerySchema = z.object({
  date: optionalDate,
});

function mapTripError(error: unknown, reply: { code: (n: number) => { send: (b: unknown) => unknown } }) {
  if (error instanceof TripNotFoundError) return reply.code(404).send({ error: error.message });
  if (error instanceof TripForbiddenError) return reply.code(403).send({ error: error.message });
  if (
    error instanceof TripValidationError ||
    error instanceof TripClosedError ||
    error instanceof TripForecastError
  ) {
    return reply.code(400).send({ error: error.message });
  }
  throw error;
}

const applyPackingSchema = z.object({
  titles: z.array(z.string().min(1).max(300)).optional(),
  items: z
    .array(
      z.object({
        title: z.string().min(1).max(300),
        section: z.enum(['clima', 'destino', 'viaje']).optional(),
      }),
    )
    .optional(),
});

function requireUserId(user: JwtPayload): string {
  if (isTripGuestPayload(user)) {
    throw new TripForbiddenError('Se requiere una cuenta');
  }
  return user.userId;
}

export default async function tripRoutes(app: FastifyInstance) {
  app.get('/trips', { preHandler: [app.authenticateUser] }, async (request) => {
    return listTripsForUser(app.prisma, (request.user as JwtUserPayload).userId);
  });

  app.post('/trips', { preHandler: [app.authenticateUser] }, async (request, reply) => {
    const body = createTripSchema.parse(request.body ?? {});
    const userId = (request.user as JwtUserPayload).userId;
    try {
      const user = await app.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { name: true },
      });
      const trip = await createTrip(app.prisma, userId, body, user.name);
      return reply.code(201).send(trip);
    } catch (error) {
      return mapTripError(error, reply);
    }
  });

  app.get('/trips/invite/:code', async (request, reply) => {
    const { code } = inviteCodeParams.parse(request.params);
    try {
      return await getTripInvitePreview(app.prisma, code);
    } catch (error) {
      return mapTripError(error, reply);
    }
  });

  app.post('/trips/join', async (request, reply) => {
    const body = joinSchema.parse(request.body ?? {});
    try {
      let userId: string | null = null;
      let userName = '';
      try {
        await request.jwtVerify();
        const user = request.user as JwtPayload;
        if (!isTripGuestPayload(user)) {
          userId = user.userId;
          const row = await app.prisma.user.findUnique({
            where: { id: userId },
            select: { name: true },
          });
          userName = row?.name ?? '';
        }
      } catch {
        // anonymous guest join
      }

      const member = await joinTripByCode(app.prisma, userId, userName, body.code, {
        displayName: body.displayName,
        claimMemberId: body.claimMemberId,
      });

      const guestToken =
        userId == null
          ? app.jwt.sign({
              kind: 'trip_guest',
              userId: '',
              householdId: '',
              email: '',
              tripId: member.tripId,
              tripMemberId: member.id,
            })
          : undefined;

      return reply.code(201).send({
        memberId: member.id,
        tripId: member.tripId,
        guestToken,
        isGuestSession: userId == null,
        trip: {
          id: member.trip.id,
          name: member.trip.name,
          shareSlug: member.trip.shareSlug,
          destination: member.trip.destination,
          status: member.trip.status,
        },
      });
    } catch (error) {
      return mapTripError(error, reply);
    }
  });

  app.post('/trips/:tripId/link-account', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { tripId } = tripIdParams.parse(request.params);
    const body = linkAccountSchema.parse(request.body ?? {});
    if (!isTripGuestPayload(request.user)) {
      return reply.code(400).send({ error: 'Ya tenés una cuenta en esta sesión' });
    }
    if (request.user.tripId !== tripId) {
      return reply.code(403).send({ error: 'No tenés acceso a este viaje' });
    }

    try {
      let user =
        body.mode === 'login'
          ? await app.prisma.user.findUnique({ where: { email: body.email } })
          : null;

      if (body.mode === 'login') {
        if (!user || !user.passwordHash || !(await bcrypt.compare(body.password, user.passwordHash))) {
          return reply.code(401).send({ error: 'Email o contraseña incorrectos' });
        }
      } else {
        const existing = await app.prisma.user.findUnique({ where: { email: body.email } });
        if (existing) {
          return reply.code(409).send({ error: 'Ya existe una cuenta con ese email' });
        }
        const member = await app.prisma.tripMember.findUniqueOrThrow({
          where: { id: request.user.tripMemberId },
          select: { displayName: true },
        });
        user = await app.prisma.user.create({
          data: {
            householdId: null,
            name: body.name?.trim() || member.displayName,
            email: body.email,
            passwordHash: await bcrypt.hash(body.password, 10),
            authProvider: 'password',
          },
        });
      }

      await linkTripMemberToUser(app.prisma, tripId, request.user.tripMemberId, user!.id, body.name);

      const token = app.jwt.sign({
        kind: 'user',
        userId: user!.id,
        householdId: jwtHouseholdId(user!.householdId),
        email: user!.email,
      });

      return {
        token,
        user: {
          id: user!.id,
          name: user!.name,
          email: user!.email,
          householdId: user!.householdId,
          isSuperUser: isSuperUser(user!.email),
          isGuestSession: false,
        },
      };
    } catch (error) {
      return mapTripError(error, reply);
    }
  });

  app.get('/trips/:tripId', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { tripId } = tripIdParams.parse(request.params);
    const { actor, householdId, isGuestSession } = tripActorFromRequest(request);
    try {
      return await getTripHub(app.prisma, tripId, actor, householdId, { isGuestSession });
    } catch (error) {
      return mapTripError(error, reply);
    }
  });

  app.patch('/trips/:tripId', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { tripId } = tripIdParams.parse(request.params);
    const body = updateTripSchema.parse(request.body ?? {});
    const { actor } = tripActorFromRequest(request);
    try {
      return await updateTrip(app.prisma, tripId, actor, body);
    } catch (error) {
      return mapTripError(error, reply);
    }
  });

  app.post('/trips/:tripId/close', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { tripId } = tripIdParams.parse(request.params);
    const { actor } = tripActorFromRequest(request);
    try {
      return await closeTrip(app.prisma, tripId, actor);
    } catch (error) {
      return mapTripError(error, reply);
    }
  });

  app.get('/trips/:tripId/members', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { tripId } = tripIdParams.parse(request.params);
    const { actor, householdId, isGuestSession } = tripActorFromRequest(request);
    try {
      const hub = await getTripHub(app.prisma, tripId, actor, householdId, { isGuestSession });
      return hub.members;
    } catch (error) {
      return mapTripError(error, reply);
    }
  });

  app.post('/trips/:tripId/members', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { tripId } = tripIdParams.parse(request.params);
    const body = createMemberSchema.parse(request.body ?? {});
    try {
      const userId = requireUserId(request.user);
      const member = await createTripMember(app.prisma, tripId, userId, body);
      return reply.code(201).send(member);
    } catch (error) {
      return mapTripError(error, reply);
    }
  });

  app.delete('/trips/:tripId/members/:memberId', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { tripId, memberId } = memberIdParams.parse(request.params);
    try {
      const userId = requireUserId(request.user);
      await deleteTripMember(app.prisma, tripId, userId, memberId);
      return reply.code(204).send();
    } catch (error) {
      return mapTripError(error, reply);
    }
  });

  app.post('/trips/:tripId/members/:memberId/merge', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { tripId, memberId } = memberIdParams.parse(request.params);
    const body = mergeMemberSchema.parse(request.body ?? {});
    try {
      const userId = requireUserId(request.user);
      const member = await mergeTripMember(app.prisma, tripId, userId, memberId, body.intoMemberId);
      return member;
    } catch (error) {
      return mapTripError(error, reply);
    }
  });

  app.post('/trips/:tripId/invites', { preHandler: [app.authenticateUser] }, async (request, reply) => {
    const { tripId } = tripIdParams.parse(request.params);
    try {
      const invite = await mintTripInvite(app.prisma, tripId, (request.user as JwtUserPayload).userId);
      return reply.code(201).send(invite);
    } catch (error) {
      return mapTripError(error, reply);
    }
  });

  app.patch('/trips/:tripId/members/:memberId', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { tripId, memberId } = memberIdParams.parse(request.params);
    const body = memberPatchSchema.parse(request.body ?? {});
    try {
      const userId = requireUserId(request.user);
      return await updateTripMember(app.prisma, tripId, userId, memberId, body);
    } catch (error) {
      return mapTripError(error, reply);
    }
  });

  app.get('/trips/:tripId/households', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { tripId } = tripIdParams.parse(request.params);
    const { actor } = tripActorFromRequest(request);
    try {
      return await listTripHouseholds(app.prisma, tripId, actor);
    } catch (error) {
      return mapTripError(error, reply);
    }
  });

  app.post('/trips/:tripId/households', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { tripId } = tripIdParams.parse(request.params);
    const body = createHouseholdSchema.parse(request.body ?? {});
    try {
      const userId = requireUserId(request.user);
      const household = await createTripHousehold(app.prisma, tripId, userId, body);
      return reply.code(201).send(household);
    } catch (error) {
      return mapTripError(error, reply);
    }
  });

  app.patch('/trips/:tripId/households/:householdId', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { tripId, householdId } = householdIdParams.parse(request.params);
    const body = householdPatchSchema.parse(request.body ?? {});
    try {
      const userId = requireUserId(request.user);
      return await updateTripHousehold(app.prisma, tripId, userId, householdId, body);
    } catch (error) {
      return mapTripError(error, reply);
    }
  });

  app.delete('/trips/:tripId/households/:householdId', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { tripId, householdId } = householdIdParams.parse(request.params);
    try {
      const userId = requireUserId(request.user);
      await deleteTripHousehold(app.prisma, tripId, userId, householdId);
      return reply.code(204).send();
    } catch (error) {
      return mapTripError(error, reply);
    }
  });

  app.get('/trips/:tripId/expenses', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { tripId } = tripIdParams.parse(request.params);
    const { actor } = tripActorFromRequest(request);
    try {
      return await listTripExpenses(app.prisma, tripId, actor);
    } catch (error) {
      return mapTripError(error, reply);
    }
  });

  app.get('/trips/:tripId/expenses/:expenseId', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { tripId, expenseId } = expenseIdParams.parse(request.params);
    const { actor } = tripActorFromRequest(request);
    try {
      return await getTripExpense(app.prisma, tripId, expenseId, actor);
    } catch (error) {
      return mapTripError(error, reply);
    }
  });

  app.post('/trips/:tripId/expenses', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { tripId } = tripIdParams.parse(request.params);
    const body = expenseBodySchema.parse(request.body ?? {});
    const { actor } = tripActorFromRequest(request);
    try {
      const expense = await createTripExpense(app.prisma, tripId, actor, body);
      return reply.code(201).send(expense);
    } catch (error) {
      return mapTripError(error, reply);
    }
  });

  app.patch('/trips/:tripId/expenses/:expenseId', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { tripId, expenseId } = expenseIdParams.parse(request.params);
    const body = expensePatchSchema.parse(request.body ?? {});
    const { actor } = tripActorFromRequest(request);
    try {
      return await updateTripExpense(app.prisma, tripId, expenseId, actor, body);
    } catch (error) {
      return mapTripError(error, reply);
    }
  });

  app.delete('/trips/:tripId/expenses/:expenseId', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { tripId, expenseId } = expenseIdParams.parse(request.params);
    const { actor } = tripActorFromRequest(request);
    try {
      await deleteTripExpense(app.prisma, tripId, expenseId, actor);
      return reply.code(204).send();
    } catch (error) {
      return mapTripError(error, reply);
    }
  });

  app.get('/trips/:tripId/balances', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { tripId } = tripIdParams.parse(request.params);
    const { actor, householdId, isGuestSession } = tripActorFromRequest(request);
    try {
      await getTripHub(app.prisma, tripId, actor, householdId, { isGuestSession });
      return await computeTripBalance(app.prisma, tripId);
    } catch (error) {
      return mapTripError(error, reply);
    }
  });

  app.get('/trips/:tripId/settle/preview', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { tripId } = tripIdParams.parse(request.params);
    const { actor, householdId, isGuestSession } = tripActorFromRequest(request);
    try {
      await getTripHub(app.prisma, tripId, actor, householdId, { isGuestSession });
      return await computeTripBalance(app.prisma, tripId);
    } catch (error) {
      return mapTripError(error, reply);
    }
  });

  app.post('/trips/:tripId/settle', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { tripId } = tripIdParams.parse(request.params);
    const body = settleSchema.parse(request.body ?? {});
    const { actor } = tripActorFromRequest(request);
    try {
      const balance = await settleTrip(app.prisma, tripId, actor, body);
      return { balance };
    } catch (error) {
      return mapTripError(error, reply);
    }
  });

  app.get('/trips/:tripId/forecast', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { tripId } = tripIdParams.parse(request.params);
    const { actor } = tripActorFromRequest(request);
    try {
      return await getTripForecast(app.prisma, tripId, actor);
    } catch (error) {
      return mapTripError(error, reply);
    }
  });

  app.post(
    '/trips/:tripId/packing-suggestions/apply',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { tripId } = tripIdParams.parse(request.params);
      const body = applyPackingSchema.parse(request.body ?? {});
      const { actor } = tripActorFromRequest(request);
      try {
        const selection = body.items?.length
          ? body.items
          : body.titles;
        const created = await applyPackingSuggestions(app.prisma, tripId, actor, selection);
        return reply.code(201).send(created);
      } catch (error) {
        return mapTripError(error, reply);
      }
    },
  );

  app.get('/trips/:tripId/list-items', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { tripId } = tripIdParams.parse(request.params);
    const query = z
      .object({ type: z.enum(['TODO', 'PACK', 'BUY']).optional() })
      .parse(request.query ?? {});
    const { actor } = tripActorFromRequest(request);
    try {
      return await listTripListItems(app.prisma, tripId, actor, query.type);
    } catch (error) {
      return mapTripError(error, reply);
    }
  });

  app.get('/trips/:tripId/list-items/:itemId', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { tripId, itemId } = itemIdParams.parse(request.params);
    const { actor } = tripActorFromRequest(request);
    try {
      return await getTripListItem(app.prisma, tripId, itemId, actor);
    } catch (error) {
      return mapTripError(error, reply);
    }
  });

  app.get(
    '/trips/:tripId/list-items/:itemId/activities',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { tripId, itemId } = itemIdParams.parse(request.params);
      const { actor } = tripActorFromRequest(request);
      try {
        return await listTripListItemActivities(app.prisma, tripId, itemId, actor);
      } catch (error) {
        return mapTripError(error, reply);
      }
    },
  );

  app.post('/trips/:tripId/list-items', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { tripId } = tripIdParams.parse(request.params);
    const body = listItemBodySchema.parse(request.body ?? {});
    const { actor } = tripActorFromRequest(request);
    try {
      const item = await createTripListItem(app.prisma, tripId, actor, body);
      return reply.code(201).send(item);
    } catch (error) {
      return mapTripError(error, reply);
    }
  });

  app.patch('/trips/:tripId/list-items/:itemId', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { tripId, itemId } = itemIdParams.parse(request.params);
    const body = listItemPatchSchema.parse(request.body ?? {});
    const { actor } = tripActorFromRequest(request);
    try {
      return await updateTripListItem(app.prisma, tripId, itemId, actor, body);
    } catch (error) {
      return mapTripError(error, reply);
    }
  });

  app.delete('/trips/:tripId/list-items/:itemId', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { tripId, itemId } = itemIdParams.parse(request.params);
    const { actor } = tripActorFromRequest(request);
    try {
      await deleteTripListItem(app.prisma, tripId, itemId, actor);
      return reply.code(204).send();
    } catch (error) {
      return mapTripError(error, reply);
    }
  });

  app.get('/trips/:tripId/accommodation', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { tripId } = tripIdParams.parse(request.params);
    const { actor } = tripActorFromRequest(request);
    try {
      return (await getTripAccommodation(app.prisma, tripId, actor)) ?? null;
    } catch (error) {
      return mapTripError(error, reply);
    }
  });

  app.put('/trips/:tripId/accommodation', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { tripId } = tripIdParams.parse(request.params);
    const body = accommodationSchema.parse(request.body ?? {});
    const { actor } = tripActorFromRequest(request);
    try {
      return await upsertTripAccommodation(app.prisma, tripId, actor, body);
    } catch (error) {
      return mapTripError(error, reply);
    }
  });

  app.get('/trips/:tripId/itinerary', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { tripId } = tripIdParams.parse(request.params);
    const query = itineraryQuerySchema.parse(request.query ?? {});
    const { actor } = tripActorFromRequest(request);
    try {
      return await listTripItinerary(app.prisma, tripId, actor, { date: query.date ?? null });
    } catch (error) {
      return mapTripError(error, reply);
    }
  });

  app.post('/trips/:tripId/itinerary', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { tripId } = tripIdParams.parse(request.params);
    const body = itineraryCreateSchema.parse(request.body ?? {});
    const { actor } = tripActorFromRequest(request);
    try {
      const item = await createTripItineraryItem(app.prisma, tripId, actor, body);
      return reply.code(201).send(item);
    } catch (error) {
      return mapTripError(error, reply);
    }
  });

  app.patch('/trips/:tripId/itinerary/:itemId', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { tripId, itemId } = itemIdParams.parse(request.params);
    const body = itineraryPatchSchema.parse(request.body ?? {});
    const { actor } = tripActorFromRequest(request);
    try {
      return await updateTripItineraryItem(app.prisma, tripId, itemId, actor, {
        ...body,
        dayDate: body.dayDate === null ? undefined : body.dayDate,
      });
    } catch (error) {
      return mapTripError(error, reply);
    }
  });

  app.delete('/trips/:tripId/itinerary/:itemId', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { tripId, itemId } = itemIdParams.parse(request.params);
    const { actor } = tripActorFromRequest(request);
    try {
      await deleteTripItineraryItem(app.prisma, tripId, itemId, actor);
      return reply.code(204).send();
    } catch (error) {
      return mapTripError(error, reply);
    }
  });

  app.get('/trips/:tripId/export/preview', { preHandler: [app.authenticateUser] }, async (request, reply) => {
    const { tripId } = tripIdParams.parse(request.params);
    const user = request.user as JwtUserPayload;
    if (!user.householdId) {
      return reply.code(400).send({ error: 'Necesitás un hogar para Pasar a Biko' });
    }
    try {
      await getTripHub(app.prisma, tripId, user.userId, user.householdId);
      return await previewTripExport(app.prisma, tripId, user.userId, user.householdId);
    } catch (error) {
      return mapTripError(error, reply);
    }
  });

  app.post('/trips/:tripId/export', { preHandler: [app.authenticateUser] }, async (request, reply) => {
    const { tripId } = tripIdParams.parse(request.params);
    const user = request.user as JwtUserPayload;
    if (!user.householdId) {
      return reply.code(400).send({ error: 'Necesitás un hogar para Pasar a Biko' });
    }
    const body = z
      .object({ replace: z.boolean().optional() })
      .passthrough()
      .parse(typeof request.body === 'object' && request.body != null ? request.body : {});
    try {
      const result = await exportTripToHousehold(app.prisma, tripId, user.userId, user.householdId, {
        replace: body.replace === true,
      });
      return {
        batchId: result.batch.id,
        purchaseIds: result.purchaseIds,
        purchaseId: result.purchaseIds[0] ?? null,
        netShare: result.preview.netShare,
        categoryMix: result.preview.categoryMix,
        members: result.preview.members,
      };
    } catch (error) {
      return mapTripError(error, reply);
    }
  });
}
