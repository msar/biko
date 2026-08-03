import bcrypt from 'bcryptjs';
import { ARGENTINE_PROVINCES, isSuperUser, normalizeBankPrograms } from '@biko/shared';
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ensureDefaultPaymentMethods } from '../services/household-defaults.js';
import {
  createAuthenticationOptions,
  createRegistrationOptions,
  sessionUserPayload,
  verifyAndStoreRegistration,
  verifyAuthentication,
} from '../services/webauthn.js';

const registerSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  // Crea un hogar nuevo con este nombre, o se une a uno existente por inviteCode.
  householdName: z.string().min(1).optional(),
  inviteCode: z.string().optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export default async function authRoutes(app: FastifyInstance) {
  app.post('/auth/register', async (request, reply) => {
    const body = registerSchema.parse(request.body);
    if (!body.householdName && !body.inviteCode) {
      return reply.code(400).send({ error: 'Indicá householdName (hogar nuevo) o inviteCode (unirse a uno)' });
    }

    const existing = await app.prisma.user.findUnique({ where: { email: body.email } });
    if (existing) {
      return reply.code(409).send({ error: 'Ya existe una cuenta con ese email' });
    }

    let householdId: string;
    if (body.inviteCode) {
      const household = await app.prisma.household.findUnique({ where: { inviteCode: body.inviteCode } });
      if (!household) return reply.code(404).send({ error: 'Código de invitación inválido' });
      householdId = household.id;
    } else {
      const household = await app.prisma.household.create({ data: { name: body.householdName! } });
      householdId = household.id;
      await ensureDefaultPaymentMethods(app.prisma, householdId);
      await app.prisma.household.update({
        where: { id: householdId },
        data: { defaultMethodsAddedAt: new Date() },
      });
    }

    const user = await app.prisma.user.create({
      data: {
        householdId,
        name: body.name,
        email: body.email,
        passwordHash: await bcrypt.hash(body.password, 10),
        authProvider: 'password',
      },
    });

    const token = app.jwt.sign({ userId: user.id, householdId, email: user.email });
    return reply.code(201).send({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        householdId,
        isSuperUser: isSuperUser(user.email),
      },
    });
  });

  app.post('/auth/login', async (request, reply) => {
    const body = loginSchema.parse(request.body);
    const user = await app.prisma.user.findUnique({ where: { email: body.email } });
    // Cuentas migradas a un provider externo (Clerk) no tienen passwordHash.
    if (!user || !user.passwordHash || !(await bcrypt.compare(body.password, user.passwordHash))) {
      return reply.code(401).send({ error: 'Email o contraseña incorrectos' });
    }
    const token = app.jwt.sign({ userId: user.id, householdId: user.householdId, email: user.email });
    return {
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        householdId: user.householdId,
        isSuperUser: isSuperUser(user.email),
      },
    };
  });

  app.post('/auth/webauthn/register/options', { preHandler: [app.authenticate] }, async (request) => {
    const user = await app.prisma.user.findUniqueOrThrow({ where: { id: request.user.userId } });
    return createRegistrationOptions(app.prisma, {
      id: user.id,
      email: user.email,
      name: user.name,
    });
  });

  app.post('/auth/webauthn/register/verify', { preHandler: [app.authenticate] }, async (request) => {
    const body = z
      .object({
        response: z.record(z.unknown()),
        deviceName: z.string().min(1).max(80).optional(),
      })
      .parse(request.body);
    const credential = await verifyAndStoreRegistration(
      app.prisma,
      request.user.userId,
      body.response as unknown as Parameters<typeof verifyAndStoreRegistration>[2],
      body.deviceName,
    );
    return { credential };
  });

  app.post('/auth/webauthn/login/options', async () => {
    return createAuthenticationOptions(app.prisma);
  });

  app.post('/auth/webauthn/login/verify', async (request, reply) => {
    const body = z.object({ response: z.record(z.unknown()) }).parse(request.body);
    try {
      const user = await verifyAuthentication(
        app.prisma,
        body.response as unknown as Parameters<typeof verifyAuthentication>[1],
      );
      const token = app.jwt.sign({
        userId: user.id,
        householdId: user.householdId,
        email: user.email,
      });
      return {
        token,
        user: sessionUserPayload(user),
      };
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode ?? 401;
      return reply.code(status).send({
        error: err instanceof Error ? err.message : 'No autorizado',
      });
    }
  });

  app.get('/auth/webauthn/credentials', { preHandler: [app.authenticate] }, async (request) => {
    const credentials = await app.prisma.webAuthnCredential.findMany({
      where: { userId: request.user.userId },
      select: { id: true, deviceName: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    return { credentials };
  });

  app.delete('/auth/webauthn/credentials/:id', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const result = await app.prisma.webAuthnCredential.deleteMany({
      where: { id, userId: request.user.userId },
    });
    if (result.count === 0) return reply.code(404).send({ error: 'Passkey no encontrada' });
    return reply.code(204).send();
  });

  app.get('/auth/me', { preHandler: [app.authenticate] }, async (request) => {
    const user = await app.prisma.user.findUniqueOrThrow({
      where: { id: request.user.userId },
      include: {
        household: {
          select: {
            id: true,
            name: true,
            inviteCode: true,
            province: true,
            bankPrograms: true,
            users: { select: { id: true, name: true }, orderBy: { id: 'asc' } },
          },
        },
      },
    });
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      isSuperUser: isSuperUser(user.email),
      household: {
        id: user.household.id,
        name: user.household.name,
        inviteCode: user.household.inviteCode,
        province: user.household.province,
        bankPrograms: user.household.bankPrograms,
        members: user.household.users,
      },
    };
  });

  app.patch('/household', { preHandler: [app.authenticate] }, async (request, reply) => {
    const body = z
      .object({
        province: z.string().nullable().optional(),
        bankPrograms: z.array(z.string()).optional(),
      })
      .parse(request.body);
    if (
      body.province != null &&
      !ARGENTINE_PROVINCES.includes(body.province as (typeof ARGENTINE_PROVINCES)[number])
    ) {
      return reply.code(400).send({ error: 'Provincia inválida' });
    }
    const data: { province?: string | null; bankPrograms?: string[] } = {};
    if (body.province !== undefined) data.province = body.province;
    if (body.bankPrograms !== undefined) data.bankPrograms = normalizeBankPrograms(body.bankPrograms);
    const household = await app.prisma.household.update({
      where: { id: request.user.householdId },
      data,
      select: { id: true, name: true, inviteCode: true, province: true, bankPrograms: true },
    });
    return { household };
  });
}
