/**
 * Climate-band packing catalog (destination + weather).
 * Research-aligned: classify forecast → curated Spanish items with reasons.
 */

export type PackingSection = 'clima' | 'destino' | 'viaje';

export type PackingSuggestion = {
  title: string;
  reason: string;
  section: PackingSection;
};

export type TripForecastDaily = {
  date: string;
  tMax: number;
  tMin: number;
  precipProb: number;
  weatherCode: number;
  uvIndexMax?: number;
  precipSum?: number;
  windSpeedMax?: number;
};

export type DestinationPackingContext = {
  name: string;
  country?: string;
  countryCode?: string;
  admin1?: string;
  elevation?: number;
  /** Original free-text trip destination (for keyword heuristics). */
  query?: string;
};

export type ClimateBand = 'freezing' | 'cold' | 'mild' | 'warm' | 'hot';

export type ClimateProfile = {
  band: ClimateBand;
  variable: boolean;
  wet: boolean;
  stormy: boolean;
  snowy: boolean;
  highUv: boolean;
  windy: boolean;
  tMin: number;
  tMax: number;
  avgMax: number;
  swing: number;
  rainyDays: number;
  maxUv: number;
  precipTotalMm: number;
  maxWind: number;
};

export type DestinationTraits = {
  coastal: boolean;
  mountain: boolean;
  highAltitude: boolean;
  elevationM: number | null;
};

const COASTAL_RE =
  /\b(costa|playa|balneario|mar\b|océano|oceano|isla|caribbean|caribe|beach|seaside|litoral)\b/i;
const MOUNTAIN_RE =
  /\b(sierra|cerro|montaña|montana|andes|cordillera|alpin|alpes|ski|nieve|mountain|peak)\b/i;

export function classifyDestination(ctx: DestinationPackingContext | null | undefined): DestinationTraits {
  const haystack = [ctx?.query, ctx?.name, ctx?.admin1, ctx?.country].filter(Boolean).join(' ');
  const elevationM = ctx?.elevation != null && Number.isFinite(ctx.elevation) ? ctx.elevation : null;
  return {
    coastal: COASTAL_RE.test(haystack),
    mountain: MOUNTAIN_RE.test(haystack),
    highAltitude: elevationM != null && elevationM >= 1200,
    elevationM,
  };
}

export function classifyClimate(daily: TripForecastDaily[]): ClimateProfile | null {
  if (daily.length === 0) return null;

  const tMin = Math.min(...daily.map((d) => d.tMin));
  const tMax = Math.max(...daily.map((d) => d.tMax));
  const avgMax = daily.reduce((sum, d) => sum + d.tMax, 0) / daily.length;
  const swing = tMax - tMin;
  const rainyDays = daily.filter((d) => d.precipProb > 40).length;
  const precipTotalMm = daily.reduce((sum, d) => sum + (d.precipSum ?? 0), 0);
  const maxUv = Math.max(0, ...daily.map((d) => d.uvIndexMax ?? 0));
  const maxWind = Math.max(0, ...daily.map((d) => d.windSpeedMax ?? 0));

  const snowy = daily.some((d) => {
    const code = d.weatherCode;
    return (code >= 71 && code <= 77) || (code >= 85 && code <= 86);
  });
  const stormy = daily.some((d) => d.weatherCode >= 95);
  const wet =
    rainyDays >= 1 ||
    stormy ||
    precipTotalMm >= 5 ||
    daily.some((d) => d.weatherCode >= 51 && d.weatherCode <= 67) ||
    daily.some((d) => d.weatherCode >= 80 && d.weatherCode <= 82);

  let band: ClimateBand;
  if (tMin <= 0 || snowy) band = 'freezing';
  else if (tMin < 8 || avgMax < 12) band = 'cold';
  else if (tMax >= 30 || avgMax >= 28) band = 'hot';
  else if (avgMax >= 22 && tMax < 30) band = 'warm';
  else band = 'mild';

  const variable = swing >= 12 && tMin < 18 && tMax > 20;

  return {
    band,
    variable,
    wet,
    stormy,
    snowy,
    highUv: maxUv >= 6,
    windy: maxWind >= 40,
    tMin,
    tMax,
    avgMax,
    swing,
    rainyDays,
    maxUv,
    precipTotalMm,
    maxWind,
  };
}

/** Short Spanish label for “Según el clima” subtitle. */
export function climateBandLabelEs(profile: ClimateProfile): string {
  const base: Record<ClimateBand, string> = {
    freezing: 'muy frío',
    cold: 'fresco',
    mild: 'templado',
    warm: 'cálido',
    hot: 'caluroso',
  };
  let label = base[profile.band];
  if (profile.snowy) label = 'con nieve';
  else if (profile.wet && (profile.band === 'hot' || profile.band === 'warm')) label = `${label} y húmedo`;
  else if (profile.wet) label = `${label} y con lluvia`;
  else if (profile.variable) label = `${label} y variable`;
  return label;
}

function pushUnique(
  suggestions: PackingSuggestion[],
  title: string,
  reason: string,
  section: PackingSection,
) {
  suggestions.push({ title, reason, section });
}

function pushClimateItems(suggestions: PackingSuggestion[], profile: ClimateProfile) {
  const { band, tMin, tMax, swing, rainyDays, maxUv, stormy, snowy, highUv, windy, variable } =
    profile;

  if (band === 'freezing') {
    pushUnique(suggestions, 'Campera de abrigo', `Mínimas cerca de ${Math.round(tMin)}°C`, 'clima');
    pushUnique(suggestions, 'Buzo o polar', 'Capa intermedia para el frío', 'clima');
    pushUnique(suggestions, 'Guantes', 'Extremidades al frío', 'clima');
    pushUnique(suggestions, 'Gorro de lana', 'Protección contra el frío', 'clima');
    pushUnique(suggestions, 'Calzado cerrado', 'Para el frío y el piso frío', 'clima');
  } else if (band === 'cold') {
    pushUnique(suggestions, 'Abrigo', `Mínimas cerca de ${Math.round(tMin)}°C`, 'clima');
    pushUnique(suggestions, 'Buzo o polar', 'Para las noches más frescas', 'clima');
    pushUnique(suggestions, 'Calzado cerrado', 'Días frescos', 'clima');
  } else if (band === 'mild') {
    pushUnique(
      suggestions,
      'Buzo liviano',
      `Noches cerca de ${Math.round(tMin)}°C`,
      'clima',
    );
  } else if (band === 'warm') {
    pushUnique(suggestions, 'Ropa liviana', `Máximas cerca de ${Math.round(tMax)}°C`, 'clima');
    pushUnique(suggestions, 'Protector solar', 'Días cálidos', 'clima');
    pushUnique(suggestions, 'Gorra', 'Para el sol', 'clima');
  } else if (band === 'hot') {
    pushUnique(suggestions, 'Ropa liviana', `Máximas cerca de ${Math.round(tMax)}°C`, 'clima');
    pushUnique(suggestions, 'Protector solar', 'Días de mucho calor', 'clima');
    pushUnique(suggestions, 'Gorra o sombrero', 'Para el sol fuerte', 'clima');
    pushUnique(suggestions, 'Anteojos de sol', 'Días soleados y calurosos', 'clima');
    pushUnique(suggestions, 'Botella de agua', 'Hidratación con el calor', 'clima');
  }

  if (highUv && band !== 'hot' && band !== 'warm') {
    pushUnique(
      suggestions,
      'Protector solar',
      `Índice UV hasta ${Math.round(maxUv)}`,
      'clima',
    );
    pushUnique(suggestions, 'Anteojos de sol', 'UV alto en el destino', 'clima');
  } else if (highUv && band === 'warm') {
    pushUnique(
      suggestions,
      'Anteojos de sol',
      `Índice UV hasta ${Math.round(maxUv)}`,
      'clima',
    );
  }

  if (variable) {
    pushUnique(
      suggestions,
      'Ropa en capas',
      `Amplitud térmica de ~${Math.round(swing)}°C`,
      'clima',
    );
  }

  if (snowy) {
    pushUnique(suggestions, 'Calzado para nieve', 'Hay probabilidad de nieve', 'clima');
    pushUnique(suggestions, 'Ropa térmica', 'Para el frío y la nieve', 'clima');
  } else if (stormy || rainyDays >= 3 || profile.precipTotalMm >= 20) {
    pushUnique(
      suggestions,
      'Impermeable',
      rainyDays >= 3
        ? `${rainyDays} días con lluvia probable`
        : stormy
          ? 'Hay riesgo de tormenta'
          : 'Lluvia acumulada importante',
      'clima',
    );
    pushUnique(suggestions, 'Calzado cerrado', 'Por si llueve fuerte', 'clima');
  } else if (profile.wet) {
    pushUnique(
      suggestions,
      'Paraguas o impermeable',
      rainyDays === 1
        ? 'Hay un día con lluvia probable'
        : rainyDays > 1
          ? `Hay ${rainyDays} días con lluvia probable`
          : 'Hay humedad o llovizna en el pronóstico',
      'clima',
    );
  }

  if (windy && band !== 'freezing') {
    pushUnique(
      suggestions,
      'Cortaviento liviano',
      `Ráfagas cerca de ${Math.round(profile.maxWind)} km/h`,
      'clima',
    );
  }
}

function pushDestinationItems(
  suggestions: PackingSuggestion[],
  traits: DestinationTraits,
  profile: ClimateProfile | null,
) {
  if (traits.coastal) {
    pushUnique(suggestions, 'Traje de baño', 'Destino costero / playa', 'destino');
    pushUnique(suggestions, 'Toalla de playa o viaje', 'Para la costa', 'destino');
    if (!profile || profile.band === 'warm' || profile.band === 'hot' || profile.highUv) {
      pushUnique(suggestions, 'Protector solar', 'Sol en la costa', 'destino');
    }
  }

  if (traits.highAltitude) {
    const elev = traits.elevationM != null ? Math.round(traits.elevationM) : null;
    pushUnique(
      suggestions,
      'Abrigo liviano o polar',
      elev != null ? `Altitud ~${elev} m — noches más frescas` : 'Altitud elevada',
      'destino',
    );
    pushUnique(suggestions, 'Ropa en capas', 'La temperatura baja con la altura', 'destino');
    pushUnique(
      suggestions,
      'Protector solar',
      elev != null ? `UV más fuerte a ~${elev} m` : 'UV más fuerte en altura',
      'destino',
    );
  } else if (traits.mountain && !traits.coastal) {
    pushUnique(suggestions, 'Calzado cerrado', 'Terreno de sierra / montaña', 'destino');
    pushUnique(suggestions, 'Buzo o polar', 'Zona de sierra — noches frescas', 'destino');
  }
}

function pushTripLengthBasics(suggestions: PackingSuggestion[], tripDayCount: number) {
  if (tripDayCount < 2) return;

  const nights = tripDayCount - 1;
  if (tripDayCount >= 7) {
    const mudas = Math.min(5, Math.max(3, nights));
    pushUnique(
      suggestions,
      `${mudas} mudas de ropa`,
      `${tripDayCount} días / ${nights} noches — alcanza con menos si lavás`,
      'viaje',
    );
    pushUnique(suggestions, 'Detergente de viaje', 'Para lavar en viajes largos', 'viaje');
    return;
  }

  pushUnique(
    suggestions,
    `${Math.max(nights, 1)} mudas de ropa`,
    `Viaje de ${tripDayCount} días`,
    'viaje',
  );
}

function ensureMildBaseline(
  suggestions: PackingSuggestion[],
  profile: ClimateProfile,
  tripDayCount: number,
) {
  if (tripDayCount < 2) return;
  const hasClima = suggestions.some((s) => s.section === 'clima');
  if (hasClima) return;

  // Mild dry trips still get one climate-appropriate cue.
  if (profile.band === 'mild' || profile.band === 'warm') {
    pushUnique(
      suggestions,
      profile.avgMax >= 20 ? 'Ropa cómoda de día' : 'Buzo liviano',
      `Pronóstico templado (${Math.round(profile.tMin)}–${Math.round(profile.tMax)}°C)`,
      'clima',
    );
  }
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

/**
 * Build packing suggestions from forecast + optional destination context.
 */
export function buildPackingCatalog(
  daily: TripForecastDaily[],
  tripDayCount: number,
  destination?: DestinationPackingContext | null,
): { suggestions: PackingSuggestion[]; profile: ClimateProfile | null; climateLabel: string | null } {
  const suggestions: PackingSuggestion[] = [];
  const profile = classifyClimate(daily);
  const traits = classifyDestination(destination);

  if (profile) {
    pushClimateItems(suggestions, profile);
  }
  pushDestinationItems(suggestions, traits, profile);
  pushTripLengthBasics(suggestions, tripDayCount);

  if (profile) {
    ensureMildBaseline(suggestions, profile, tripDayCount);
  } else if (tripDayCount >= 2) {
    pushTripLengthBasics(suggestions, tripDayCount);
  }

  const deduped = dedupeSuggestions(suggestions);
  return {
    suggestions: deduped,
    profile,
    climateLabel: profile ? climateBandLabelEs(profile) : null,
  };
}
