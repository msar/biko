/** Auth keys in localStorage. Service worker / Workbox must never clear these. */
export const AUTH_TOKEN_KEY = 'biko:token';
export const AUTH_USER_KEY = 'biko:user';

const AUTH_KEYS = new Set([AUTH_TOKEN_KEY, AUTH_USER_KEY]);

export function readAuthToken(): string | null {
  return localStorage.getItem(AUTH_TOKEN_KEY);
}

export function writeAuthToken(token: string | null): void {
  if (token) localStorage.setItem(AUTH_TOKEN_KEY, token);
  else localStorage.removeItem(AUTH_TOKEN_KEY);
}

export function readCachedAuthUser<T>(): T | null {
  const raw = localStorage.getItem(AUTH_USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function writeCachedAuthUser(user: unknown | null): void {
  if (user == null) localStorage.removeItem(AUTH_USER_KEY);
  else localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
}

export function clearAuthStorage(): void {
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(AUTH_USER_KEY);
}

/** True if a key is session auth (never wipe on SW activate / cache cleanup). */
export function isAuthStorageKey(key: string): boolean {
  return AUTH_KEYS.has(key);
}
