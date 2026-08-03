import type { AuthenticatorTransportFuture } from '@simplewebauthn/server';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';
import type { PrismaClient } from '@prisma/client';
import { isSuperUser } from '@biko/shared';

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

export type WebAuthnConfig = {
  rpID: string;
  origin: string;
  rpName: string;
};

export function getWebAuthnConfig(): WebAuthnConfig {
  const isProd = process.env.NODE_ENV === 'production';
  const rpID = process.env.WEBAUTHN_RP_ID ?? (isProd ? undefined : 'localhost');
  const origin = process.env.WEBAUTHN_ORIGIN ?? (isProd ? undefined : 'http://localhost:5173');
  if (!rpID || !origin) {
    const err = new Error('WebAuthn no configurado (WEBAUTHN_RP_ID / WEBAUTHN_ORIGIN)');
    (err as Error & { statusCode: number }).statusCode = 503;
    throw err;
  }
  return { rpID, origin, rpName: 'Biko' };
}

export function sessionUserPayload(user: {
  id: string;
  name: string;
  email: string;
  householdId: string;
}) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    householdId: user.householdId,
    isSuperUser: isSuperUser(user.email),
  };
}

async function purgeExpiredChallenges(prisma: PrismaClient) {
  await prisma.webAuthnChallenge.deleteMany({ where: { expiresAt: { lt: new Date() } } });
}

async function storeChallenge(
  prisma: PrismaClient,
  params: { challenge: string; type: 'registration' | 'authentication'; userId?: string },
) {
  await purgeExpiredChallenges(prisma);
  await prisma.webAuthnChallenge.create({
    data: {
      challenge: params.challenge,
      type: params.type,
      userId: params.userId,
      expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
    },
  });
}

async function consumeChallenge(
  prisma: PrismaClient,
  challenge: string,
  type: 'registration' | 'authentication',
) {
  const row = await prisma.webAuthnChallenge.findUnique({ where: { challenge } });
  if (!row || row.type !== type || row.expiresAt < new Date()) {
    return null;
  }
  await prisma.webAuthnChallenge.delete({ where: { id: row.id } });
  return row;
}

function challengeFromClientData(clientDataJSON: string): string {
  const json = Buffer.from(clientDataJSON, 'base64url').toString('utf8');
  const parsed = JSON.parse(json) as { challenge?: string };
  if (!parsed.challenge) throw new Error('Challenge ausente');
  return parsed.challenge;
}

export async function createRegistrationOptions(
  prisma: PrismaClient,
  user: { id: string; email: string; name: string },
) {
  const { rpID, rpName } = getWebAuthnConfig();
  const existing = await prisma.webAuthnCredential.findMany({
    where: { userId: user.id },
    select: { credentialId: true, transports: true },
  });

  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userName: user.email,
    userDisplayName: user.name,
    userID: new TextEncoder().encode(user.id),
    attestationType: 'none',
    excludeCredentials: existing.map((c) => ({
      id: c.credentialId,
      transports: c.transports as AuthenticatorTransportFuture[],
    })),
    authenticatorSelection: {
      authenticatorAttachment: 'platform',
      residentKey: 'required',
      userVerification: 'required',
    },
  });

  await storeChallenge(prisma, {
    challenge: options.challenge,
    type: 'registration',
    userId: user.id,
  });

  return options;
}

export async function verifyAndStoreRegistration(
  prisma: PrismaClient,
  userId: string,
  response: RegistrationResponseJSON,
  deviceName?: string,
) {
  const { rpID, origin } = getWebAuthnConfig();
  const challenge = challengeFromClientData(response.response.clientDataJSON);
  const stored = await consumeChallenge(prisma, challenge, 'registration');
  if (!stored || stored.userId !== userId) {
    const err = new Error('Challenge inválido o expirado');
    (err as Error & { statusCode: number }).statusCode = 400;
    throw err;
  }

  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge: challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: true,
  });

  if (!verification.verified || !verification.registrationInfo) {
    const err = new Error('No se pudo verificar la passkey');
    (err as Error & { statusCode: number }).statusCode = 400;
    throw err;
  }

  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
  const created = await prisma.webAuthnCredential.create({
    data: {
      userId,
      credentialId: credential.id,
      publicKey: Buffer.from(credential.publicKey),
      counter: BigInt(credential.counter),
      transports: (credential.transports ?? response.response.transports ?? []) as string[],
      deviceName: deviceName ?? (credentialDeviceType === 'multiDevice' && credentialBackedUp ? 'Passkey' : 'Este dispositivo'),
    },
  });

  return {
    id: created.id,
    deviceName: created.deviceName,
    createdAt: created.createdAt,
  };
}

export async function createAuthenticationOptions(prisma: PrismaClient) {
  const { rpID } = getWebAuthnConfig();
  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: 'required',
  });

  await storeChallenge(prisma, {
    challenge: options.challenge,
    type: 'authentication',
  });

  return options;
}

export async function verifyAuthentication(
  prisma: PrismaClient,
  response: AuthenticationResponseJSON,
) {
  const { rpID, origin } = getWebAuthnConfig();
  const challenge = challengeFromClientData(response.response.clientDataJSON);
  const stored = await consumeChallenge(prisma, challenge, 'authentication');
  if (!stored) {
    const err = new Error('Challenge inválido o expirado');
    (err as Error & { statusCode: number }).statusCode = 400;
    throw err;
  }

  const cred = await prisma.webAuthnCredential.findUnique({
    where: { credentialId: response.id },
    include: { user: true },
  });
  if (!cred) {
    const err = new Error('Passkey no reconocida');
    (err as Error & { statusCode: number }).statusCode = 401;
    throw err;
  }

  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge: challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    credential: {
      id: cred.credentialId,
      publicKey: new Uint8Array(cred.publicKey),
      counter: Number(cred.counter),
      transports: cred.transports as AuthenticatorTransportFuture[],
    },
    requireUserVerification: true,
  });

  if (!verification.verified) {
    const err = new Error('No se pudo verificar la biometría');
    (err as Error & { statusCode: number }).statusCode = 401;
    throw err;
  }

  await prisma.webAuthnCredential.update({
    where: { id: cred.id },
    data: { counter: BigInt(verification.authenticationInfo.newCounter) },
  });

  return cred.user;
}
