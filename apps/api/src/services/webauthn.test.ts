import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: vi.fn(async () => ({
    challenge: 'reg-challenge',
    rp: { name: 'Biko', id: 'localhost' },
    user: { id: 'uid', name: 'a@b.com', displayName: 'A' },
    pubKeyCredParams: [],
  })),
  generateAuthenticationOptions: vi.fn(async () => ({
    challenge: 'auth-challenge',
    rpId: 'localhost',
    allowCredentials: [],
  })),
  verifyRegistrationResponse: vi.fn(async () => ({
    verified: true,
    registrationInfo: {
      fmt: 'none',
      aaguid: '00000000-0000-0000-0000-000000000000',
      credential: {
        id: 'cred-1',
        publicKey: new Uint8Array([1, 2, 3]),
        counter: 0,
        transports: ['internal'],
      },
      credentialType: 'public-key',
      attestationObject: new Uint8Array(),
      userVerified: true,
      credentialDeviceType: 'singleDevice',
      credentialBackedUp: false,
      origin: 'http://localhost:5173',
      rpID: 'localhost',
    },
  })),
  verifyAuthenticationResponse: vi.fn(async () => ({
    verified: true,
    authenticationInfo: {
      credentialID: 'cred-1',
      newCounter: 1,
      userVerified: true,
      credentialDeviceType: 'singleDevice',
      credentialBackedUp: false,
      origin: 'http://localhost:5173',
      rpID: 'localhost',
    },
  })),
}));

import {
  createAuthenticationOptions,
  createRegistrationOptions,
  getWebAuthnConfig,
  sessionUserPayload,
  verifyAndStoreRegistration,
  verifyAuthentication,
} from './webauthn.js';

function clientData(challenge: string) {
  return Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge, origin: 'http://localhost:5173' }), 'utf8').toString(
    'base64url',
  );
}

function makePrisma() {
  const challenges = new Map<string, { id: string; userId: string | null; challenge: string; type: string; expiresAt: Date }>();
  const credentials = new Map<
    string,
    {
      id: string;
      userId: string;
      credentialId: string;
      publicKey: Buffer;
      counter: bigint;
      transports: string[];
      deviceName: string | null;
      createdAt: Date;
      user?: { id: string; name: string; email: string; householdId: string };
    }
  >();

  return {
    webAuthnChallenge: {
      deleteMany: vi.fn(async () => ({ count: 0 })),
      create: vi.fn(async ({ data }: { data: { challenge: string; type: string; userId?: string; expiresAt: Date } }) => {
        const row = {
          id: `ch-${challenges.size + 1}`,
          userId: data.userId ?? null,
          challenge: data.challenge,
          type: data.type,
          expiresAt: data.expiresAt,
        };
        challenges.set(data.challenge, row);
        return row;
      }),
      findUnique: vi.fn(async ({ where }: { where: { challenge: string } }) => challenges.get(where.challenge) ?? null),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        for (const [k, v] of challenges) {
          if (v.id === where.id) challenges.delete(k);
        }
      }),
    },
    webAuthnCredential: {
      findMany: vi.fn(async () => [...credentials.values()]),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: 'db-cred-1',
          userId: data.userId as string,
          credentialId: data.credentialId as string,
          publicKey: data.publicKey as Buffer,
          counter: data.counter as bigint,
          transports: data.transports as string[],
          deviceName: (data.deviceName as string) ?? null,
          createdAt: new Date(),
        };
        credentials.set(row.credentialId, row);
        return row;
      }),
      findUnique: vi.fn(async ({ where }: { where: { credentialId: string } }) => {
        const row = credentials.get(where.credentialId);
        if (!row) return null;
        return {
          ...row,
          user: { id: row.userId, name: 'Aylen', email: 'a@b.com', householdId: 'hh1' },
        };
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: { counter: bigint } }) => {
        for (const row of credentials.values()) {
          if (row.id === where.id) row.counter = data.counter;
        }
      }),
    },
    _challenges: challenges,
    _credentials: credentials,
  };
}

describe('getWebAuthnConfig', () => {
  beforeEach(() => {
    delete process.env.WEBAUTHN_RP_ID;
    delete process.env.WEBAUTHN_ORIGIN;
    process.env.NODE_ENV = 'test';
  });

  it('defaults to localhost outside production', () => {
    expect(getWebAuthnConfig()).toEqual({
      rpID: 'localhost',
      origin: 'http://localhost:5173',
      rpName: 'Biko',
    });
  });

  it('fails in production without env', () => {
    process.env.NODE_ENV = 'production';
    expect(() => getWebAuthnConfig()).toThrow(/WEBAUTHN/);
  });
});

describe('sessionUserPayload', () => {
  it('maps user fields and superuser flag', () => {
    expect(sessionUserPayload({ id: '1', name: 'A', email: 'x@y.com', householdId: 'h' })).toMatchObject({
      id: '1',
      householdId: 'h',
      isSuperUser: expect.any(Boolean),
    });
  });
});

describe('webauthn registration/authentication', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    delete process.env.WEBAUTHN_RP_ID;
    delete process.env.WEBAUTHN_ORIGIN;
  });

  it('creates registration options and stores challenge', async () => {
    const prisma = makePrisma();
    const options = await createRegistrationOptions(prisma as never, {
      id: 'u1',
      email: 'a@b.com',
      name: 'Aylen',
    });
    expect(options.challenge).toBe('reg-challenge');
    expect(prisma.webAuthnChallenge.create).toHaveBeenCalled();
  });

  it('verifies registration and stores credential', async () => {
    const prisma = makePrisma();
    await createRegistrationOptions(prisma as never, { id: 'u1', email: 'a@b.com', name: 'Aylen' });
    const result = await verifyAndStoreRegistration(prisma as never, 'u1', {
      id: 'cred-1',
      rawId: 'cred-1',
      type: 'public-key',
      clientExtensionResults: {},
      response: {
        clientDataJSON: clientData('reg-challenge'),
        attestationObject: 'aa',
        transports: ['internal'],
      },
    } as never);
    expect(result.id).toBe('db-cred-1');
    expect(prisma.webAuthnCredential.create).toHaveBeenCalled();
  });

  it('creates auth options and verifies login', async () => {
    const prisma = makePrisma();
    prisma._credentials.set('cred-1', {
      id: 'db-cred-1',
      userId: 'u1',
      credentialId: 'cred-1',
      publicKey: Buffer.from([1, 2, 3]),
      counter: 0n,
      transports: ['internal'],
      deviceName: 'Phone',
      createdAt: new Date(),
    });

    const options = await createAuthenticationOptions(prisma as never);
    expect(options.challenge).toBe('auth-challenge');

    const user = await verifyAuthentication(prisma as never, {
      id: 'cred-1',
      rawId: 'cred-1',
      type: 'public-key',
      clientExtensionResults: {},
      response: {
        clientDataJSON: Buffer.from(
          JSON.stringify({ type: 'webauthn.get', challenge: 'auth-challenge', origin: 'http://localhost:5173' }),
          'utf8',
        ).toString('base64url'),
        authenticatorData: 'aa',
        signature: 'bb',
      },
    } as never);

    expect(user.email).toBe('a@b.com');
    expect(prisma.webAuthnCredential.update).toHaveBeenCalled();
  });
});
