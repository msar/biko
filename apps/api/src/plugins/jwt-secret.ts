/** Default only for local/dev. Never use this in deployed environments. */
export const DEV_JWT_FALLBACK = 'dev-secret-change-me';

/**
 * Production-like hosts must use a persistent JWT_SECRET.
 * Railway often omits NODE_ENV; RAILWAY_* is set on every Railway deploy.
 */
export function requiresPersistentJwtSecret(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (env.NODE_ENV === 'production') return true;
  if (env.RAILWAY_ENVIRONMENT || env.RAILWAY_PROJECT_ID) return true;
  return false;
}

/** Unresolved Railway `${{ secret() }}` templates must never be used as the signing key. */
export function looksLikeRailwaySecretTemplate(value: string): boolean {
  return /\$\{\{\s*secret\s*\(/i.test(value) || /secret\s*\(\s*\d+/i.test(value);
}

export interface ResolvedJwtSecrets {
  /** Used to sign new tokens and tried first on verify. */
  primary: string;
  /** Optional previous secret for zero-downtime rotation. */
  previous: string | null;
}

/**
 * Resolve the signing secret for session JWTs.
 * Missing/default secrets in production log every user out on the next boot —
 * fail loudly instead of silently minting/verifying with a fallback.
 *
 * Set JWT_SECRET_PREVIOUS temporarily when rotating so old tokens still verify.
 */
export function resolveJwtSecrets(env: NodeJS.ProcessEnv = process.env): ResolvedJwtSecrets {
  const secret = env.JWT_SECRET?.trim();
  const previous = env.JWT_SECRET_PREVIOUS?.trim() || null;

  if (requiresPersistentJwtSecret(env)) {
    if (!secret || secret === DEV_JWT_FALLBACK) {
      throw new Error(
        'JWT_SECRET must be set to a persistent non-default value. ' +
          'Omitting or rotating it invalidates every session on deploy. ' +
          'Set a stable Railway variable (plain string) and never use ${{ secret() }}.',
      );
    }
    if (looksLikeRailwaySecretTemplate(secret)) {
      throw new Error(
        'JWT_SECRET looks like a Railway ${{ secret() }} template. ' +
          'Replace it with a fixed literal (openssl rand -base64 48). ' +
          'Template secrets can regenerate and log everyone out.',
      );
    }
  }

  if (previous && previous === secret) {
    return { primary: secret || DEV_JWT_FALLBACK, previous: null };
  }

  return { primary: secret || DEV_JWT_FALLBACK, previous };
}

/** @deprecated Prefer resolveJwtSecrets — kept for tests and simple callers. */
export function resolveJwtSecret(env: NodeJS.ProcessEnv = process.env): string {
  return resolveJwtSecrets(env).primary;
}
