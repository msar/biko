import { isSuperUser } from '@biko/shared';
import fjwt from '@fastify/jwt';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { resolveJwtSecrets } from './jwt-secret';

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
  const { primary, previous } = resolveJwtSecrets();

  await app.register(fjwt, {
    secret: primary,
    sign: { expiresIn: '180d' },
  });

  // Optional previous secret so rotating JWT_SECRET does not mass-logout clients.
  if (previous) {
    await app.register(fjwt, {
      namespace: 'prev',
      secret: previous,
    });
  }

  app.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
      return;
    } catch {
      // try previous signer below
    }

    if (previous) {
      try {
        // namespace "prev" → request.prevJwtVerify (see @fastify/jwt)
        await (
          request as FastifyRequest & { prevJwtVerify: () => Promise<unknown> }
        ).prevJwtVerify();
        return;
      } catch {
        // both secrets rejected the token
      }
    }

    return reply.code(401).send({ error: 'No autorizado', code: 'AUTH_INVALID' });
  });

  app.decorate('requireSuperUser', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!isSuperUser(request.user.email)) {
      return reply.code(403).send({ error: 'Acceso denegado' });
    }
  });
});
