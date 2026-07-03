import bcrypt from 'bcryptjs';
import { ARGENTINE_PROVINCES } from '@biko/shared';
import { FastifyInstance } from 'fastify';
import { z } from 'zod';

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
    return reply.code(201).send({ token, user: { id: user.id, name: user.name, email: user.email, householdId } });
  });

  app.post('/auth/login', async (request, reply) => {
    const body = loginSchema.parse(request.body);
    const user = await app.prisma.user.findUnique({ where: { email: body.email } });
    // Cuentas migradas a un provider externo (Clerk) no tienen passwordHash.
    if (!user || !user.passwordHash || !(await bcrypt.compare(body.password, user.passwordHash))) {
      return reply.code(401).send({ error: 'Email o contraseña incorrectos' });
    }
    const token = app.jwt.sign({ userId: user.id, householdId: user.householdId, email: user.email });
    return { token, user: { id: user.id, name: user.name, email: user.email, householdId: user.householdId } };
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
            users: { select: { id: true, name: true }, orderBy: { id: 'asc' } },
          },
        },
      },
    });
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      household: {
        id: user.household.id,
        name: user.household.name,
        inviteCode: user.household.inviteCode,
        province: user.household.province,
        members: user.household.users,
      },
    };
  });

  app.patch('/household', { preHandler: [app.authenticate] }, async (request, reply) => {
    const body = z
      .object({ province: z.string().nullable() })
      .parse(request.body);
    if (body.province != null && !ARGENTINE_PROVINCES.includes(body.province as (typeof ARGENTINE_PROVINCES)[number])) {
      return reply.code(400).send({ error: 'Provincia inválida' });
    }
    const household = await app.prisma.household.update({
      where: { id: request.user.householdId },
      data: { province: body.province },
      select: { id: true, name: true, inviteCode: true, province: true },
    });
    return { household };
  });
}
