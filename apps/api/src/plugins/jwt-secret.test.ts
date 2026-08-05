import { describe, expect, it } from 'vitest';
import {
  DEV_JWT_FALLBACK,
  looksLikeRailwaySecretTemplate,
  requiresPersistentJwtSecret,
  resolveJwtSecret,
  resolveJwtSecrets,
} from './jwt-secret';

describe('resolveJwtSecret', () => {
  it('uses dev fallback when unset outside production', () => {
    const env = { NODE_ENV: 'development' } as NodeJS.ProcessEnv;
    expect(resolveJwtSecret(env)).toBe(DEV_JWT_FALLBACK);
    expect(requiresPersistentJwtSecret(env)).toBe(false);
  });

  it('throws in NODE_ENV=production when missing', () => {
    const env = { NODE_ENV: 'production' } as NodeJS.ProcessEnv;
    expect(() => resolveJwtSecret(env)).toThrow(/JWT_SECRET must be set/);
  });

  it('throws in NODE_ENV=production when using the dev fallback', () => {
    const env = { NODE_ENV: 'production', JWT_SECRET: DEV_JWT_FALLBACK } as NodeJS.ProcessEnv;
    expect(() => resolveJwtSecret(env)).toThrow(/JWT_SECRET must be set/);
  });

  it('throws on Railway even when NODE_ENV is unset', () => {
    const env = { RAILWAY_ENVIRONMENT: 'production' } as NodeJS.ProcessEnv;
    expect(requiresPersistentJwtSecret(env)).toBe(true);
    expect(() => resolveJwtSecret(env)).toThrow(/persistent/);
  });

  it('accepts a stable secret on Railway', () => {
    const env = {
      RAILWAY_PROJECT_ID: 'proj_123',
      JWT_SECRET: 'stable-production-secret-value',
    } as NodeJS.ProcessEnv;
    expect(resolveJwtSecret(env)).toBe('stable-production-secret-value');
  });

  it('rejects unresolved Railway secret() templates', () => {
    const env = {
      NODE_ENV: 'production',
      JWT_SECRET: '${{ secret(32, "abcdefghijklmnopqrstuvwxyz012345") }}',
    } as NodeJS.ProcessEnv;
    expect(looksLikeRailwaySecretTemplate(env.JWT_SECRET!)).toBe(true);
    expect(() => resolveJwtSecret(env)).toThrow(/secret\(\)/);
  });

  it('exposes JWT_SECRET_PREVIOUS for rotation', () => {
    const env = {
      NODE_ENV: 'production',
      JWT_SECRET: 'new-stable-secret-value-here',
      JWT_SECRET_PREVIOUS: 'old-stable-secret-value-here',
    } as NodeJS.ProcessEnv;
    expect(resolveJwtSecrets(env)).toEqual({
      primary: 'new-stable-secret-value-here',
      previous: 'old-stable-secret-value-here',
    });
  });
});
