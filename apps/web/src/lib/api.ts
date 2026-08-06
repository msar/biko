import { clearAuthStorage, readAuthToken, writeAuthToken } from './auth-storage';

const BASE = import.meta.env.VITE_API_URL ?? '/api';

/** Backoff before confirming a 401 is real (deploy blip + PWA SW reload). */
const AUTH_CONFIRM_BACKOFF_MS = [0, 1_500, 4_000] as const;
const AUTH_CONFIRM_SW_BACKOFF_MS = [0, 2_000, 5_000, 10_000] as const;
const SW_RELOAD_FLAG = 'biko:sw-updated';
/** After a PWA controllerchange reload, be patient for this long. */
const SW_RELOAD_GRACE_MS = 30_000;

let authToken: string | null = readAuthToken();
let unauthorizedHandler: (() => void) | null = null;
/** Single in-flight session check so parallel 401s don't stampede or race-clear. */
let sessionConfirm: Promise<boolean> | null = null;
let swGraceUntil = 0;

export function setToken(token: string | null) {
  authToken = token;
  writeAuthToken(token);
}

export function getToken() {
  // Storage is source of truth across tabs / SW reloads.
  authToken = readAuthToken();
  return authToken;
}

/** Limpia sesión cuando el token es inválido o expiró. */
export function onUnauthorized(handler: () => void) {
  unauthorizedHandler = handler;
}

/** Mark that auth checks should be extra patient (PWA controllerchange). */
export function markServiceWorkerReload(): void {
  swGraceUntil = Date.now() + SW_RELOAD_GRACE_MS;
  try {
    sessionStorage.setItem(SW_RELOAD_FLAG, String(swGraceUntil));
  } catch {
    // sessionStorage may be unavailable; in-memory grace still applies this tab.
  }
}

function inServiceWorkerGrace(): boolean {
  if (Date.now() < swGraceUntil) return true;
  try {
    const raw = sessionStorage.getItem(SW_RELOAD_FLAG);
    if (!raw) return false;
    const until = Number(raw);
    if (Number.isFinite(until) && Date.now() < until) {
      swGraceUntil = until;
      return true;
    }
    sessionStorage.removeItem(SW_RELOAD_FLAG);
  } catch {
    // ignore
  }
  return false;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

function isPublicAuthPath(path: string): boolean {
  return (
    path === '/auth/login' ||
    path === '/auth/register' ||
    path.startsWith('/auth/webauthn/login/') ||
    path.startsWith('/trips/invite/') ||
    path === '/trips/join'
  );
}

/**
 * Confirm the stored token is truly invalid.
 * - 401 on every attempt → false (clear session)
 * - network / 5xx / other → true (keep session)
 */
async function confirmSessionValid(extraPatient: boolean): Promise<boolean> {
  const token = readAuthToken();
  if (!token) return false;
  if (sessionConfirm) return sessionConfirm;

  const delays = extraPatient ? AUTH_CONFIRM_SW_BACKOFF_MS : AUTH_CONFIRM_BACKOFF_MS;

  sessionConfirm = (async () => {
    try {
      for (let i = 0; i < delays.length; i++) {
        const wait = delays[i]!;
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));

        // Token may have been cleared by another tab while we waited.
        const current = readAuthToken();
        if (!current) return false;

        try {
          const res = await fetch(`${BASE}/auth/me`, {
            headers: { Authorization: `Bearer ${current}` },
          });
          if (res.status === 401) continue;
          // Any non-401 (2xx, 5xx, 404, …) → do not treat as logged out.
          return true;
        } catch {
          // Network blip — keep session.
          return true;
        }
      }
      return false;
    } finally {
      sessionConfirm = null;
    }
  })();

  return sessionConfirm;
}

function clearSessionFromApi(): void {
  authToken = null;
  clearAuthStorage();
  unauthorizedHandler?.();
}

export async function api<T>(path: string, options: RequestInit = {}, didRetry = false): Promise<T> {
  // Storage is source of truth (SW reload, other tabs). Do not fall back to stale memory.
  authToken = readAuthToken();

  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      // Content-Type solo con body: Fastify rechaza JSON vacío (ej. DELETE).
      ...(options.body != null ? { 'Content-Type': 'application/json' } : {}),
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...options.headers,
    },
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && !isPublicAuthPath(path)) {
      // After a SW reload (or on /auth/me bootstrap), use a longer confirm window.
      const extraPatient = !didRetry && (inServiceWorkerGrace() || path === '/auth/me');
      const stillValid = await confirmSessionValid(extraPatient);
      if (!stillValid) {
        clearSessionFromApi();
      } else if (!didRetry && readAuthToken()) {
        // Transient 401 (deploy blip) — session still good; retry the original call.
        return api(path, options, true);
      }
    }
    throw new ApiError(
      res.status,
      (body as { error?: string }).error ?? 'Error de red',
      (body as { code?: string }).code,
    );
  }
  return body as T;
}

export const fmtARS = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  maximumFractionDigits: 0,
});

export const fmtARSExact = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' });

export const fmtUSD = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'USD',
});

export function fmtMoney(amount: number, currency: 'ARS' | 'USD' = 'ARS'): string {
  return currency === 'USD' ? fmtUSD.format(amount) : fmtARS.format(amount);
}

export function fmtMoneyExact(amount: number, currency: 'ARS' | 'USD' = 'ARS'): string {
  return currency === 'USD' ? fmtUSD.format(amount) : fmtARSExact.format(amount);
}

export function toArsDisplay(amount: number, exchangeRateToArs = 1): number {
  return Math.round(amount * exchangeRateToArs * 100) / 100;
}
export function fmtDate(date: string | Date): string {
  return new Date(date).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
}

export const DAY_LABEL: Record<string, string> = {
  MONDAY: 'Lunes',
  TUESDAY: 'Martes',
  WEDNESDAY: 'Miércoles',
  THURSDAY: 'Jueves',
  FRIDAY: 'Viernes',
  SATURDAY: 'Sábado',
  SUNDAY: 'Domingo',
};

const DAY_SHORT: Record<string, string> = {
  MONDAY: 'Lun',
  TUESDAY: 'Mar',
  WEDNESDAY: 'Mié',
  THURSDAY: 'Jue',
  FRIDAY: 'Vie',
  SATURDAY: 'Sáb',
  SUNDAY: 'Dom',
};

/** "Lun, Mié y Dom" — vacío = "Todos los días". */
export function formatDays(days: string[]): string {
  if (days.length === 0) return 'Todos los días';
  const labels = days.map((d) => DAY_SHORT[d] ?? d);
  if (labels.length === 1) return DAY_LABEL[days[0]!] ?? days[0]!;
  return `${labels.slice(0, -1).join(', ')} y ${labels[labels.length - 1]}`;
}
