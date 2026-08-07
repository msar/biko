import type { Prisma, PrismaClient } from '@prisma/client';
import {
  calendarDateToUtc,
  todayYmdInTimeZone,
  tripTimeZone,
  ymdInTimeZone,
} from '../lib/calendar-date.js';
import {
  createTripListItem,
  requireTripMember,
  updateTripListItem,
  TripValidationError,
  type TripActor,
} from './trip.js';
import {
  geocodeTripDestination,
  TripDestinationNotFoundError,
  TripLocationError,
} from './trip-location.js';

/** Single Keep-style PACK item that holds weather packing suggestions as a checklist. */
export const PACKING_LIST_TITLE = 'Lista para llevar';
/** Pre-rename title — still matched so existing trips keep working. */
const PACKING_LIST_TITLE_LEGACY = 'Lista para traer';
const CHECKLIST_MARK = /^[☐☑✓✗xX•\-*]\s*/;

export function isPackingListTitle(title: string): boolean {
  const key = title.trim().toLowerCase();
  return (
    key === PACKING_LIST_TITLE.toLowerCase() ||
    key === PACKING_LIST_TITLE_LEGACY.toLowerCase()
  );
}

export function formatPackingChecklistLine(title: string): string {
  return `☐ ${title.trim()}`;
}

export function packingChecklistTitles(notes: string | null | undefined): string[] {
  if (!notes?.trim()) return [];
  return notes
    .split('\n')
    .map((line) => line.replace(CHECKLIST_MARK, '').trim())
    .filter(Boolean);
}

function mergePackingChecklist(existingNotes: string | null | undefined, titles: string[]): string {
  const lines = existingNotes?.trim()
    ? existingNotes
        .split('\n')
        .map((line) => line.trimEnd())
        .filter((line) => line.trim().length > 0)
    : [];
  const seen = new Set(packingChecklistTitles(existingNotes).map((t) => t.toLowerCase()));

  for (const title of titles) {
    const trimmed = title.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(formatPackingChecklistLine(trimmed));
  }

  return lines.join('\n');
}

type Db = PrismaClient | Prisma.TransactionClient;

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

function ymd(d: Date, timeZone: string): string {
  return ymdInTimeZone(d, timeZone);
}

function parseYmd(s: string, timeZone: string): Date {
  return calendarDateToUtc(s, timeZone);
}

function addDaysYmd(ymdStr: string, days: number): string {
  const [y, m, d] = ymdStr.split('-').map(Number) as [number, number, number];
  const utc = new Date(Date.UTC(y, m - 1, d + days));
  return `${String(utc.getUTCFullYear()).padStart(4, '0')}-${String(utc.getUTCMonth() + 1).padStart(2, '0')}-${String(utc.getUTCDate()).padStart(2, '0')}`;
}

function maxYmd(a: string, b: string): string {
  return a >= b ? a : b;
}

function minYmd(a: string, b: string): string {
  return a <= b ? a : b;
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
  timezone: string;
};

async function geocodeDestination(destination: string): Promise<GeoResult> {
  try {
    return await geocodeTripDestination(destination);
  } catch (error) {
    if (error instanceof TripDestinationNotFoundError) {
      throw new TripValidationError(error.message);
    }
    if (error instanceof TripLocationError) {
      throw new TripForecastError(error.message);
    }
    throw error;
  }
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

function clampForecastRange(
  startDate: Date,
  endDate: Date,
  timeZone: string,
): {
  start: string;
  end: string;
  truncated: boolean;
  tripDayCount: number;
} {
  const tripStart = ymd(startDate, timeZone);
  const tripEnd = ymd(endDate, timeZone);
  if (tripEnd < tripStart) {
    throw new TripValidationError('La fecha de fin debe ser posterior al inicio');
  }

  const today = todayYmdInTimeZone(timeZone);
  const horizonEnd = addDaysYmd(today, FORECAST_HORIZON_DAYS);

  if (tripStart > horizonEnd) {
    throw new TripValidationError(
      'Todavía no hay pronóstico para esas fechas. Volvé a consultar cuando falten menos de 16 días.',
    );
  }

  if (tripEnd < today) {
    throw new TripValidationError('El viaje ya terminó; no hay pronóstico futuro para esas fechas.');
  }

  const clampedStart = maxYmd(tripStart, today);
  const clampedEnd = minYmd(tripEnd, horizonEnd);
  const truncated = clampedStart !== tripStart || clampedEnd !== tripEnd;

  const tripDayCount =
    Math.round(
      (parseYmd(tripEnd, timeZone).getTime() - parseYmd(tripStart, timeZone).getTime()) /
        (24 * 60 * 60 * 1000),
    ) + 1;

  return {
    start: clampedStart,
    end: clampedEnd,
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

  const location = await geocodeDestination(destination);
  const timeZone = trip.destinationTimezone?.trim() || location.timezone || tripTimeZone(null);
  if (!trip.destinationTimezone && location.timezone) {
    await db.trip.update({
      where: { id: tripId },
      data: { destinationTimezone: location.timezone },
    });
  }
  const range = clampForecastRange(trip.startDate, trip.endDate, timeZone);
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

  if (titles?.length) {
    wanted = titles.map((t) => t.trim()).filter(Boolean);
  } else {
    const forecast = await getTripForecast(db, tripId, actor);
    wanted = forecast.packingSuggestions.map((s) => s.title);
  }

  if (wanted.length === 0) {
    return [];
  }

  const packingLists = await db.tripListItem.findMany({
    where: { tripId, type: 'PACK' },
    select: { id: true, title: true, notes: true },
  });
  const existingList = packingLists.find((item) => isPackingListTitle(item.title));

  if (existingList) {
    const already = new Set(packingChecklistTitles(existingList.notes).map((t) => t.toLowerCase()));
    const toAdd = wanted.filter((title) => !already.has(title.toLowerCase()));
    if (toAdd.length === 0) {
      return [];
    }
    const notes = mergePackingChecklist(existingList.notes, toAdd);
    const updated = await updateTripListItem(db, tripId, existingList.id, actor, { notes });
    return [updated];
  }

  const notes = mergePackingChecklist(null, wanted);
  const created = await createTripListItem(db, tripId, actor, {
    type: 'PACK',
    title: PACKING_LIST_TITLE,
    notes,
    assignToAll: true,
  });
  return [created];
}
