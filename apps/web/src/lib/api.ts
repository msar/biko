const BASE = import.meta.env.VITE_API_URL ?? '/api';

let authToken: string | null = localStorage.getItem('biko:token');

export function setToken(token: string | null) {
  authToken = token;
  if (token) localStorage.setItem('biko:token', token);
  else localStorage.removeItem('biko:token');
}

export function getToken() {
  return authToken;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
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
    if (res.status === 401) setToken(null);
    throw new ApiError(res.status, (body as { error?: string }).error ?? 'Error de red');
  }
  return body as T;
}

export const fmtARS = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  maximumFractionDigits: 0,
});

export const fmtARSExact = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' });

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
