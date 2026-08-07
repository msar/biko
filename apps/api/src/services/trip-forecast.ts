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

/** Single Keep-style PACK item that holds weather packing suggestions as a nested checklist. */
export const PACKING_LIST_TITLE = 'Lista para llevar';
/** Pre-rename title — still matched so existing trips keep working. */
const PACKING_LIST_TITLE_LEGACY = 'Lista para traer';

/**
 * Canonical nested checklist line: `* Item` / `* [x] Item`.
 * Also accepted: `- Item`, `☐/☑ Item`, `- [ ] Item`, `• Item`, etc.
 */
const TASK_BOX = /^\[\s*([xX✓☑]|)\s*\]\s*/;

/** Dropped always-on boilerplate from older suggestion builds. */
const LEGACY_BOILERPLATE = new Set(
  ['documentos', 'cargador', 'medicamentos básicos', 'medicamentos basicos'].map((s) =>
    s.toLowerCase(),
  ),
);

export type PackingSection = 'clima' | 'viaje';

export const PACKING_SECTION_LABELS: Record<PackingSection, string> = {
  clima: 'Clima',
  viaje: 'Para el viaje',
};

const SECTION_LABEL_TO_KEY = new Map<string, PackingSection>(
  (Object.entries(PACKING_SECTION_LABELS) as Array<[PackingSection, string]>).map(
    ([key, label]) => [label.toLowerCase(), key],
  ),
);

export function isPackingListTitle(title: string): boolean {
  const key = title.trim().toLowerCase();
  return (
    key === PACKING_LIST_TITLE.toLowerCase() ||
    key === PACKING_LIST_TITLE_LEGACY.toLowerCase()
  );
}

export function stripChecklistMarkup(line: string): string {
  let rest = line.trim();
  if (!rest) return '';
  // Orphan markers like `*` / `☐` / `-` with no label.
  if (/^[-*•☐☑✓✗]+$/.test(rest)) return '';

  const bullet = rest.match(/^[-*•]\s+/);
  if (bullet) {
    rest = rest.slice(bullet[0].length);
  } else if (/^[☐☑✓✗]\s*/.test(rest)) {
    rest = rest.replace(/^[☐☑✓✗]\s*/, '');
  }

  const box = rest.match(TASK_BOX);
  if (box) {
    rest = rest.slice(box[0].length);
  }

  return rest.trim();
}

export function isPackingSectionHeader(line: string): boolean {
  return SECTION_LABEL_TO_KEY.has(stripChecklistMarkup(line).toLowerCase());
}

export function formatPackingChecklistLine(title: string, checked = false): string {
  const clean = title.trim();
  return checked ? `* [x] ${clean}` : `* ${clean}`;
}

function isCheckedLine(line: string): boolean {
  const trimmed = line.trim();
  if (/^[☑✓]/.test(trimmed)) return true;
  if (/^[-*•]\s+\[\s*[xX✓☑]\s*\]/.test(trimmed)) return true;
  if (/^\[\s*[xX✓☑]\s*\]/.test(trimmed)) return true;
  return false;
}

function looksLikeChecklistItem(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (/^[☐☑✓✗]/.test(trimmed)) return true;
  if (/^[-*•]\s+/.test(trimmed)) return true;
  if (TASK_BOX.test(trimmed)) return true;
  return false;
}

type PackingNoteBlock =
  | { kind: 'section'; section: PackingSection }
  | { kind: 'item'; title: string; checked: boolean }
  | { kind: 'other'; text: string };

function parsePackingNotes(notes: string | null | undefined): PackingNoteBlock[] {
  if (!notes?.trim()) return [];
  const blocks: PackingNoteBlock[] = [];
  for (const raw of notes.split('\n')) {
    const trimmed = raw.trim();
    if (!trimmed) continue;

    const title = stripChecklistMarkup(trimmed);
    if (!title) continue;

    const section = SECTION_LABEL_TO_KEY.get(title.toLowerCase());
    if (section) {
      blocks.push({ kind: 'section', section });
      continue;
    }

    if (looksLikeChecklistItem(trimmed)) {
      blocks.push({ kind: 'item', title, checked: isCheckedLine(trimmed) });
      continue;
    }

    // Unmarked non-section lines are checklist items (legacy one-item-per-line notes).
    blocks.push({ kind: 'item', title, checked: false });
  }
  return blocks;
}

export function packingChecklistTitles(notes: string | null | undefined): string[] {
  return parsePackingNotes(notes)
    .filter((b): b is Extract<PackingNoteBlock, { kind: 'item' }> => b.kind === 'item')
    .map((b) => b.title);
}

function serializePackingNotes(blocks: PackingNoteBlock[]): string {
  const lines: string[] = [];
  let emittedItem = false;

  for (const block of blocks) {
    if (block.kind === 'section') {
      if (lines.length > 0 && emittedItem) lines.push('');
      lines.push(PACKING_SECTION_LABELS[block.section]);
      emittedItem = false;
      continue;
    }
    if (block.kind === 'item') {
      lines.push(formatPackingChecklistLine(block.title, block.checked));
      emittedItem = true;
      continue;
    }
    lines.push(block.text);
    emittedItem = true;
  }

  return lines.join('\n');
}

/**
 * Normalize free-form notes into the canonical nested checklist format.
 * Blank lines and empty markers are dropped; section headers stay unmarked.
 */
export function normalizePackingNotes(notes: string | null | undefined): string {
  if (!notes?.trim()) return '';
  const blocks = parsePackingNotes(notes).filter((block) => {
    if (block.kind === 'item') return !LEGACY_BOILERPLATE.has(block.title.toLowerCase());
    if (block.kind === 'other') return !LEGACY_BOILERPLATE.has(block.text.toLowerCase());
    return true;
  });
  return serializePackingNotes(blocks);
}

export function mergePackingChecklist(
  existingNotes: string | null | undefined,
  items: Array<{ title: string; section?: PackingSection }>,
): string {
  const blocks = parsePackingNotes(existingNotes);
  const sectionItems: Record<PackingSection, Array<{ title: string; checked: boolean }>> = {
    clima: [],
    viaje: [],
  };
  const orphanItems: Array<{ title: string; checked: boolean }> = [];
  let currentSection: PackingSection | null = null;

  for (const block of blocks) {
    if (block.kind === 'section') {
      currentSection = block.section;
      continue;
    }
    if (block.kind === 'item') {
      if (LEGACY_BOILERPLATE.has(block.title.toLowerCase())) continue;
      if (currentSection) sectionItems[currentSection].push(block);
      else orphanItems.push(block);
      continue;
    }
    if (LEGACY_BOILERPLATE.has(block.text.toLowerCase())) continue;
    const asItem = { title: block.text, checked: false };
    if (currentSection) sectionItems[currentSection].push(asItem);
    else orphanItems.push(asItem);
  }

  const seen = new Set(
    [...sectionItems.clima, ...sectionItems.viaje, ...orphanItems].map((i) =>
      i.title.toLowerCase(),
    ),
  );

  for (const raw of items) {
    const title = raw.title.trim();
    if (!title) continue;
    if (LEGACY_BOILERPLATE.has(title.toLowerCase())) continue;
    const key = title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    sectionItems[raw.section ?? 'viaje'].push({ title, checked: false });
  }

  // Unsectioned legacy lines sit under "Para el viaje".
  if (orphanItems.length > 0) {
    sectionItems.viaje = [...orphanItems, ...sectionItems.viaje];
  }

  const out: PackingNoteBlock[] = [];
  for (const section of ['clima', 'viaje'] as PackingSection[]) {
    const list = sectionItems[section];
    if (list.length === 0) continue;
    out.push({ kind: 'section', section });
    for (const item of list) out.push({ kind: 'item', ...item });
  }

  return serializePackingNotes(out);
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
  section: PackingSection;
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

function dedupeSuggestions(suggestions: PackingSuggestion[]): PackingSuggestion[] {
  const seen = new Set<string>();
  return suggestions.filter((s) => {
    const key = s.title.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Trip-length items only — no documentos/cargador/kit genérico. */
function pushTripLengthBasics(suggestions: PackingSuggestion[], tripDayCount: number) {
  if (tripDayCount < 2) return;

  const nights = tripDayCount - 1;
  if (tripDayCount >= 7) {
    const mudas = Math.min(5, Math.max(3, nights));
    suggestions.push({
      title: `${mudas} mudas de ropa`,
      reason: `${tripDayCount} días / ${nights} noches — alcanza con menos si lavás`,
      section: 'viaje',
    });
    suggestions.push({
      title: 'Detergente de viaje',
      reason: 'Para lavar en viajes largos',
      section: 'viaje',
    });
    return;
  }

  suggestions.push({
    title: `${Math.max(nights, 1)} mudas de ropa`,
    reason: `Viaje de ${tripDayCount} días`,
    section: 'viaje',
  });
}

/**
 * Weather- and length-driven packing ideas. Avoids always-on boilerplate
 * (documentos, cargador) that everyone already packs.
 */
export function buildPackingSuggestions(
  daily: TripForecastDaily[],
  tripDayCount: number,
): PackingSuggestion[] {
  const suggestions: PackingSuggestion[] = [];

  if (daily.length === 0) {
    pushTripLengthBasics(suggestions, tripDayCount);
    return dedupeSuggestions(suggestions);
  }

  const tMin = Math.min(...daily.map((d) => d.tMin));
  const tMax = Math.max(...daily.map((d) => d.tMax));
  const avgMax = daily.reduce((sum, d) => sum + d.tMax, 0) / daily.length;
  const swing = tMax - tMin;
  const rainyDays = daily.filter((d) => d.precipProb > 40).length;
  const snowy = daily.some((d) => {
    const code = d.weatherCode;
    return (code >= 71 && code <= 77) || (code >= 85 && code <= 86);
  });
  const stormy = daily.some((d) => d.weatherCode >= 95);

  if (tMin <= 0) {
    suggestions.push(
      {
        title: 'Campera de abrigo',
        reason: `Mínimas cerca de ${Math.round(tMin)}°C`,
        section: 'clima',
      },
      {
        title: 'Guantes',
        reason: 'Noches bajo cero o cerca',
        section: 'clima',
      },
      {
        title: 'Gorro de lana',
        reason: 'Protección contra el frío',
        section: 'clima',
      },
    );
  } else if (tMin < 8) {
    suggestions.push(
      {
        title: 'Abrigo',
        reason: `Mínimas cerca de ${Math.round(tMin)}°C`,
        section: 'clima',
      },
      {
        title: 'Buzo o polar',
        reason: 'Para las noches más frescas',
        section: 'clima',
      },
    );
  } else if (tMin < 14) {
    suggestions.push({
      title: 'Buzo liviano',
      reason: `Noches cerca de ${Math.round(tMin)}°C`,
      section: 'clima',
    });
  }

  if (tMax >= 32 || avgMax >= 30) {
    suggestions.push(
      {
        title: 'Ropa liviana',
        reason: `Máximas cerca de ${Math.round(tMax)}°C`,
        section: 'clima',
      },
      {
        title: 'Protector solar',
        reason: 'Días de mucho calor',
        section: 'clima',
      },
      {
        title: 'Gorra o sombrero',
        reason: 'Para el sol fuerte',
        section: 'clima',
      },
      {
        title: 'Anteojos de sol',
        reason: 'Días soleados y calurosos',
        section: 'clima',
      },
      {
        title: 'Botella de agua',
        reason: 'Hidratación con el calor',
        section: 'clima',
      },
    );
  } else if (tMax >= 26) {
    suggestions.push(
      {
        title: 'Ropa liviana',
        reason: `Máximas cerca de ${Math.round(tMax)}°C`,
        section: 'clima',
      },
      {
        title: 'Protector solar',
        reason: 'Hay días de calor',
        section: 'clima',
      },
      {
        title: 'Gorra',
        reason: 'Para el sol',
        section: 'clima',
      },
    );
  }

  if (swing >= 12 && tMin < 16 && tMax > 22) {
    suggestions.push({
      title: 'Ropa en capas',
      reason: `Amplitud térmica de ~${Math.round(swing)}°C`,
      section: 'clima',
    });
  }

  if (snowy) {
    suggestions.push(
      {
        title: 'Calzado para nieve',
        reason: 'Hay probabilidad de nieve',
        section: 'clima',
      },
      {
        title: 'Ropa térmica',
        reason: 'Para el frío y la nieve',
        section: 'clima',
      },
    );
  } else if (stormy || rainyDays >= 3) {
    suggestions.push(
      {
        title: 'Impermeable',
        reason:
          rainyDays >= 3
            ? `${rainyDays} días con lluvia probable`
            : 'Hay riesgo de tormenta',
        section: 'clima',
      },
      {
        title: 'Calzado cerrado',
        reason: 'Por si llueve fuerte',
        section: 'clima',
      },
    );
  } else if (rainyDays >= 1) {
    suggestions.push({
      title: 'Paraguas o impermeable',
      reason:
        rainyDays === 1
          ? 'Hay un día con lluvia probable'
          : `Hay ${rainyDays} días con lluvia probable`,
      section: 'clima',
    });
  }

  pushTripLengthBasics(suggestions, tripDayCount);
  return dedupeSuggestions(suggestions);
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

export type PackingApplyItem = {
  title: string;
  section?: PackingSection;
};

export async function applyPackingSuggestions(
  db: Db,
  tripId: string,
  actor: TripActor | string,
  selection?: string[] | PackingApplyItem[],
) {
  await requireTripMember(db, tripId, actor);

  let wanted: PackingApplyItem[];

  if (selection?.length) {
    wanted = selection.map((entry) =>
      typeof entry === 'string'
        ? { title: entry.trim(), section: undefined }
        : { title: entry.title.trim(), section: entry.section },
    );
  } else {
    const forecast = await getTripForecast(db, tripId, actor);
    wanted = forecast.packingSuggestions.map((s) => ({
      title: s.title,
      section: s.section,
    }));
  }

  wanted = wanted
    .filter((item) => item.title.length > 0)
    .map((item) => ({ ...item, section: item.section ?? 'viaje' }));
  if (wanted.length === 0) {
    return [];
  }

  const packingLists = await db.tripListItem.findMany({
    where: { tripId, type: 'PACK' },
    select: { id: true, title: true, notes: true },
  });
  const existingList = packingLists.find((item) => isPackingListTitle(item.title));

  if (existingList) {
    // Re-merge always: drops blank/orphan markers, strips legacy boilerplate,
    // normalizes to `* Item` lines, and appends any missing suggestions.
    const notes = mergePackingChecklist(existingList.notes, wanted);
    if (notes === (existingList.notes ?? '').trim()) {
      return [];
    }
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
