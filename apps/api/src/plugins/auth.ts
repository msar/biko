import { isSuperUser } from '@biko/shared';
import jwt from '@fastify/jwt';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

export interface JwtUser {
  userId: string;
  householdId: string;
  email: string;
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: JwtUser;
    user: JwtUser;
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireSuperUser: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

const DEV_FALLBACK = 'dev-secret-change-me';

function resolveJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  const isProd = process.env.NODE_ENV === 'production';
  if (isProd && (!secret || secret === DEV_FALLBACK)) {
    throw new Error('JWT_SECRET must be set to a non-default value in production');
  }
  return secret ?? DEV_FALLBACK;
}

export default fp(async (app: FastifyInstance) => {
  await app.register(jwt, {
    secret: resolveJwtSecret(),
    sign: { expiresIn: '180d' },
  });

  app.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
    } catch {
      return reply.code(401).send({ error: 'No autorizado' });
    }
  });

  app.decorate('requireSuperUser', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!isSuperUser(request.user.email)) {
      return reply.code(403).send({ error: 'Acceso denegado' });
    }
  });
});
