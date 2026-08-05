import { isSuperUser } from '@biko/shared';
import jwt from '@fastify/jwt';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { resolveJwtSecret } from './jwt-secret';

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
