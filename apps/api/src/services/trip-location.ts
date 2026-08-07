const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';

export class TripLocationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TripLocationError';
  }
}

export class TripDestinationNotFoundError extends TripLocationError {
  constructor(message = 'No encontramos ese destino. Probá con otra ciudad o país.') {
    super(message);
    this.name = 'TripDestinationNotFoundError';
  }
}

export type TripGeoResult = {
  name: string;
  country?: string;
  countryCode?: string;
  admin1?: string;
  elevation?: number;
  latitude: number;
  longitude: number;
  timezone: string;
};

/** Geocode a free-text destination via Open-Meteo (includes IANA timezone). */
export async function geocodeTripDestination(destination: string): Promise<TripGeoResult> {
  const url = new URL(GEOCODE_URL);
  url.searchParams.set('name', destination);
  url.searchParams.set('count', '1');
  url.searchParams.set('language', 'es');

  let res: Response;
  try {
    res = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
  } catch {
    throw new TripLocationError('No se pudo conectar al servicio de ubicación');
  }
  if (!res.ok) {
    throw new TripLocationError(`No se pudo ubicar el destino (${res.status})`);
  }

  const body = (await res.json()) as {
    results?: Array<{
      name: string;
      country?: string;
      country_code?: string;
      admin1?: string;
      elevation?: number;
      latitude: number;
      longitude: number;
      timezone?: string;
    }>;
  };
  const hit = body.results?.[0];
  if (!hit) {
    throw new TripDestinationNotFoundError();
  }
  return {
    name: hit.name,
    country: hit.country,
    countryCode: hit.country_code?.trim().toUpperCase() || undefined,
    admin1: hit.admin1?.trim() || undefined,
    elevation: typeof hit.elevation === 'number' && Number.isFinite(hit.elevation) ? hit.elevation : undefined,
    latitude: hit.latitude,
    longitude: hit.longitude,
    timezone: hit.timezone?.trim() || 'UTC',
  };
}

/** Best-effort timezone lookup; returns null if destination missing or geocode fails. */
export async function resolveDestinationTimezone(
  destination: string | null | undefined,
): Promise<string | null> {
  const trimmed = destination?.trim();
  if (!trimmed) return null;
  try {
    const geo = await geocodeTripDestination(trimmed);
    return geo.timezone;
  } catch {
    return null;
  }
}
