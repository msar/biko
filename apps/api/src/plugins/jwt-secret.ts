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

/**
 * Resolve the signing secret for session JWTs.
 * Missing/default secrets in production log every user out on the next boot —
 * fail loudly instead of silently minting/verifying with a fallback.
 */
export function resolveJwtSecret(env: NodeJS.ProcessEnv = process.env): string {
  const secret = env.JWT_SECRET?.trim();

  if (requiresPersistentJwtSecret(env)) {
    if (!secret || secret === DEV_JWT_FALLBACK) {
      throw new Error(
        'JWT_SECRET must be set to a persistent non-default value. ' +
          'Omitting or rotating it invalidates every session on deploy. ' +
          'Set a stable Railway variable (plain string) and never use ${{ secret() }}.',
      );
    }
  }

  return secret || DEV_JWT_FALLBACK;
}
