import type { Prisma, PrismaClient } from '@prisma/client';
import {
  createTripListItem,
  requireTripMember,
  TripValidationError,
  type TripActor,
} from './trip.js';

type Db = PrismaClient | Prisma.TransactionClient;

const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
/** Open-Meteo free forecast horizon is roughly 16 days from today. */
const FORECAST_HORIZON_DAYS = 15;

export class TripForecastError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TripForecastError';
  }
}

export type TripForecastDaily = {
  date: string;
  tMax: number;
  tMin: number;
  precipProb: number;
  weatherCode: number;
};

export type PackingSuggestion = {
  title: string;
  reason: string;
};

export type TripForecast = {
  location: {
    name: string;
    country?: string;
    latitude: number;
    longitude: number;
  };
  range: { start: string; end: string; truncated: boolean };
  daily: TripForecastDaily[];
  summary: { tMin: number; tMax: number; rainyDays: number; label: string };
  packingSuggestions: PackingSuggestion[];
};

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parseYmd(s: string): Date {
  return new Date(`${s}T12:00:00.000Z`);
}

function addDays(d: Date, days: number): Date {
  const next = new Date(d);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function maxDate(a: Date, b: Date): Date {
  return a.getTime() >= b.getTime() ? a : b;
}

function minDate(a: Date, b: Date): Date {
  return a.getTime() <= b.getTime() ? a : b;
}

function weatherLabel(code: number): string {
  if (code === 0) return 'Despejado';
  if (code <= 3) return 'Parcialmente nublado';
  if (code <= 48) return 'Niebla';
  if (code <= 57) return 'Llovizna';
  if (code <= 67) return 'Lluvia';
  if (code <= 77) return 'Nieve';
  if (code <= 82) return 'Chubascos';
  if (code <= 86) return 'Nevada';
  if (code <= 99) return 'Tormenta';
  return 'Variable';
}

function dominantWeatherLabel(daily: TripForecastDaily[]): string {
  if (daily.length === 0) return 'Sin datos';
  const counts = new Map<string, number>();
  for (const day of daily) {
    const label = weatherLabel(day.weatherCode);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  let best = 'Variable';
  let bestCount = 0;
  for (const [label, count] of counts) {
    if (count > bestCount) {
      best = label;
      bestCount = count;
    }
  }
  return best;
}

type GeoResult = {
  name: string;
  country?: string;
  latitude: number;
  longitude: number;
};

async function geocodeDestination(destination: string): Promise<GeoResult> {
  const url = new URL(GEOCODE_URL);
  url.searchParams.set('name', destination);
  url.searchParams.set('count', '1');
  url.searchParams.set('language', 'es');

  let res: Response;
  try {
    res = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
  } catch {
    throw new TripForecastError('No se pudo conectar al servicio de ubicación');
  }
  if (!res.ok) {
    throw new TripForecastError(`No se pudo ubicar el destino (${res.status})`);
  }

  const body = (await res.json()) as {
    results?: Array<{
      name: string;
      country?: string;
      latitude: number;
      longitude: number;
    }>;
  };
  const hit = body.results?.[0];
  if (!hit) {
    throw new TripValidationError('No encontramos ese destino. Probá con otra ciudad o país.');
  }
  return {
    name: hit.name,
    country: hit.country,
    latitude: hit.latitude,
    longitude: hit.longitude,
  };
}

async function fetchDailyForecast(
  latitude: number,
  longitude: number,
  start: string,
  end: string,
): Promise<TripForecastDaily[]> {
  const url = new URL(FORECAST_URL);
  url.searchParams.set('latitude', String(latitude));
  url.searchParams.set('longitude', String(longitude));
  url.searchParams.set(
    'daily',
    'temperature_2m_max,temperature_2m_min,precipitation_probability_max,weathercode',
  );
  url.searchParams.set('timezone', 'auto');
  url.searchParams.set('start_date', start);
  url.searchParams.set('end_date', end);

  let res: Response;
  try {
    res = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
  } catch {
    throw new TripForecastError('No se pudo conectar al servicio de clima');
  }
  if (!res.ok) {
    throw new TripForecastError(`No se pudo obtener el pronóstico (${res.status})`);
  }

  const body = (await res.json()) as {
    daily?: {
      time?: string[];
      temperature_2m_max?: Array<number | null>;
      temperature_2m_min?: Array<number | null>;
      precipitation_probability_max?: Array<number | null>;
      weathercode?: Array<number | null>;
    };
  };

  const times = body.daily?.time ?? [];
  if (times.length === 0) {
    throw new TripForecastError('El servicio de clima no devolvió días para ese rango');
  }

  return times.map((date, i) => ({
    date,
    tMax: Number(body.daily?.temperature_2m_max?.[i] ?? 0),
    tMin: Number(body.daily?.temperature_2m_min?.[i] ?? 0),
    precipProb: Number(body.daily?.precipitation_probability_max?.[i] ?? 0),
    weatherCode: Number(body.daily?.weathercode?.[i] ?? 0),
  }));
}

export function buildPackingSuggestions(
  daily: TripForecastDaily[],
  tripDayCount: number,
): PackingSuggestion[] {
  const suggestions: PackingSuggestion[] = [
    { title: 'Documentos', reason: 'Esenciales para viajar' },
    { title: 'Cargador', reason: 'Para el celular y otros dispositivos' },
    { title: 'Medicamentos básicos', reason: 'Por si hace falta en el camino' },
  ];

  if (daily.length === 0) return suggestions;

  const tMin = Math.min(...daily.map((d) => d.tMin));
  const tMax = Math.max(...daily.map((d) => d.tMax));
  const rainy = daily.some((d) => d.precipProb > 40);

  if (tMin < 10) {
    suggestions.push(
      { title: 'Abrigo', reason: `Mínimas cerca de ${Math.round(tMin)}°C` },
      { title: 'Buzo', reason: 'Para las noches más frescas' },
      { title: 'Gorro', reason: 'Protección contra el frío' },
    );
  }

  if (tMax > 28) {
    suggestions.push(
      { title: 'Protector solar', reason: `Máximas cerca de ${Math.round(tMax)}°C` },
      { title: 'Gorra', reason: 'Para el sol' },
      { title: 'Ropa liviana', reason: 'Días calurosos' },
    );
  }

  if (rainy) {
    suggestions.push(
      { title: 'Paraguas', reason: 'Hay días con probabilidad de lluvia alta' },
      { title: 'Impermeable', reason: 'Por si llueve' },
    );
  }

  if (tripDayCount >= 2) {
    suggestions.push(
      { title: 'Muda extra', reason: `Viaje de ${tripDayCount} días` },
      { title: 'Kit de aseo', reason: 'Para varios días afuera' },
    );
  }

  const seen = new Set<string>();
  return suggestions.filter((s) => {
    const key = s.title.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function clampForecastRange(startDate: Date, endDate: Date): {
  start: string;
  end: string;
  truncated: boolean;
  tripDayCount: number;
} {
  const tripStart = parseYmd(ymd(startDate));
  const tripEnd = parseYmd(ymd(endDate));
  if (tripEnd.getTime() < tripStart.getTime()) {
    throw new TripValidationError('La fecha de fin debe ser posterior al inicio');
  }

  const today = parseYmd(ymd(new Date()));
  const horizonEnd = addDays(today, FORECAST_HORIZON_DAYS);

  if (tripStart.getTime() > horizonEnd.getTime()) {
    throw new TripValidationError(
      'Todavía no hay pronóstico para esas fechas. Volvé a consultar cuando falten menos de 16 días.',
    );
  }

  if (tripEnd.getTime() < today.getTime()) {
    throw new TripValidationError('El viaje ya terminó; no hay pronóstico futuro para esas fechas.');
  }

  const clampedStart = maxDate(tripStart, today);
  const clampedEnd = minDate(tripEnd, horizonEnd);
  const truncated =
    ymd(clampedStart) !== ymd(tripStart) || ymd(clampedEnd) !== ymd(tripEnd);

  const tripDayCount =
    Math.round((tripEnd.getTime() - tripStart.getTime()) / (24 * 60 * 60 * 1000)) + 1;

  return {
    start: ymd(clampedStart),
    end: ymd(clampedEnd),
    truncated,
    tripDayCount,
  };
}

export async function getTripForecast(
  db: Db,
  tripId: string,
  actor: TripActor | string,
): Promise<TripForecast> {
  const me = await requireTripMember(db, tripId, actor);
  const trip = me.trip;

  const destination = trip.destination?.trim();
  if (!destination) {
    throw new TripValidationError('Falta el destino del viaje para el pronóstico');
  }
  if (!trip.startDate || !trip.endDate) {
    throw new TripValidationError('Faltan las fechas del viaje para el pronóstico');
  }

  const range = clampForecastRange(trip.startDate, trip.endDate);
  const location = await geocodeDestination(destination);
  const daily = await fetchDailyForecast(
    location.latitude,
    location.longitude,
    range.start,
    range.end,
  );

  const tMin = Math.min(...daily.map((d) => d.tMin));
  const tMax = Math.max(...daily.map((d) => d.tMax));
  const rainyDays = daily.filter((d) => d.precipProb > 40).length;
  const label = dominantWeatherLabel(daily);

  return {
    location: {
      name: location.name,
      country: location.country,
      latitude: location.latitude,
      longitude: location.longitude,
    },
    range: {
      start: range.start,
      end: range.end,
      truncated: range.truncated,
    },
    daily,
    summary: { tMin, tMax, rainyDays, label },
    packingSuggestions: buildPackingSuggestions(daily, range.tripDayCount),
  };
}

export async function applyPackingSuggestions(
  db: Db,
  tripId: string,
  actor: TripActor | string,
  titles?: string[],
) {
  await requireTripMember(db, tripId, actor);

  let wanted: string[];
  let reasonByTitle = new Map<string, string>();

  if (titles?.length) {
    wanted = titles.map((t) => t.trim()).filter(Boolean);
  } else {
    const forecast = await getTripForecast(db, tripId, actor);
    wanted = forecast.packingSuggestions.map((s) => s.title);
    reasonByTitle = new Map(
      forecast.packingSuggestions.map((s) => [s.title.toLowerCase(), s.reason]),
    );
  }

  if (wanted.length === 0) {
    return [];
  }

  const existing = await db.tripListItem.findMany({
    where: { tripId },
    select: { title: true },
  });
  const existingKeys = new Set(existing.map((i) => i.title.trim().toLowerCase()));

  const toCreate = wanted.filter((title) => !existingKeys.has(title.toLowerCase()));

  const created = [];
  for (const title of toCreate) {
    const notes = reasonByTitle.get(title.toLowerCase()) ?? null;
    const item = await createTripListItem(db, tripId, actor, {
      type: 'PACK',
      title,
      notes,
      assignToAll: true,
    });
    created.push(item);
    existingKeys.add(title.toLowerCase());
  }

  return created;
}
