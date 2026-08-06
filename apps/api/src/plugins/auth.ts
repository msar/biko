import { isSuperUser } from '@biko/shared';
import fjwt from '@fastify/jwt';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { resolveJwtSecrets } from './jwt-secret';

/**
 * JWT payload. User sessions always have `userId` + `email`.
 * Trip guests have `kind: 'trip_guest'` + trip/member ids.
 * `householdId` is `''` when the account has no Biko hogar (trip-only / guest).
 */
export interface JwtUser {
  kind?: 'user' | 'trip_guest';
  userId: string;
  householdId: string;
  email: string;
  tripId?: string;
  tripMemberId?: string;
}

export type JwtUserPayload = JwtUser;
export type JwtTripGuestPayload = JwtUser & {
  kind: 'trip_guest';
  tripId: string;
  tripMemberId: string;
};

export type JwtPayload = JwtUser;

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: JwtUser;
    user: JwtUser;
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** Rejects trip-guest JWTs — household / account-only routes. */
    authenticateUser: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireSuperUser: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export function isTripGuestPayload(user: JwtUser): user is JwtTripGuestPayload {
  return user.kind === 'trip_guest' && Boolean(user.tripId) && Boolean(user.tripMemberId);
}

export function isUserPayload(user: JwtUser): boolean {
  return user.kind !== 'trip_guest' && Boolean(user.userId);
}

/** Normalize DB null household → JWT empty string. */
export function jwtHouseholdId(householdId: string | null | undefined): string {
  return householdId ?? '';
}

async function verifyJwt(request: FastifyRequest, previous: string | undefined): Promise<boolean> {
  try {
    await request.jwtVerify();
    return true;
  } catch {
    // try previous signer below
  }

  if (previous) {
    try {
      await (
        request as FastifyRequest & { prevJwtVerify: () => Promise<unknown> }
      ).prevJwtVerify();
      return true;
    } catch {
      // both secrets rejected the token
    }
  }
  return false;
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
    if (await verifyJwt(request, previous ?? undefined)) return;
    return reply.code(401).send({ error: 'No autorizado', code: 'AUTH_INVALID' });
  });

  app.decorate('authenticateUser', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await verifyJwt(request, previous ?? undefined))) {
      return reply.code(401).send({ error: 'No autorizado', code: 'AUTH_INVALID' });
    }
    if (!isUserPayload(request.user)) {
      return reply.code(403).send({ error: 'Se requiere una cuenta', code: 'AUTH_USER_REQUIRED' });
    }
  });

  app.decorate('requireSuperUser', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!isUserPayload(request.user) || !isSuperUser(request.user.email)) {
      return reply.code(403).send({ error: 'Acceso denegado' });
    }
  });
});
