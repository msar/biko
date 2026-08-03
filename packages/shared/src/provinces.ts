/** Argentine provinces (ISO 3166-2:AR style names). */
export const ARGENTINE_PROVINCES = [
  'Buenos Aires',
  'Ciudad Autónoma de Buenos Aires',
  'Catamarca',
  'Chaco',
  'Chubut',
  'Córdoba',
  'Corrientes',
  'Entre Ríos',
  'Formosa',
  'Jujuy',
  'La Pampa',
  'La Rioja',
  'Mendoza',
  'Misiones',
  'Neuquén',
  'Río Negro',
  'Salta',
  'San Juan',
  'San Luis',
  'Santa Cruz',
  'Santa Fe',
  'Santiago del Estero',
  'Tierra del Fuego',
  'Tucumán',
] as const;

export type ArgentineProvince = (typeof ARGENTINE_PROVINCES)[number];

/** Chains that operate nationwide; promos without explicit province hints stay visible everywhere. */
const NATIONAL_CHAIN_PATTERN =
  /changom[aá]s|carrefour|coto|jumbo|disco|vea|\bd[ií]a\b|walmart|ypf|shell|axion|pa?ea|la anonima|la anónima|farmacity|farmaplus|open25|maxi|vea|megatone|garbarino|fravega|frávega|musimundo/i;

/** Explicit province / city names in copy. */
const PROVINCE_ALIASES: Array<{ province: ArgentineProvince; pattern: RegExp }> = [
  { province: 'Córdoba', pattern: /\bc[oó]rdoba\b|\bcba\b/i },
  { province: 'Ciudad Autónoma de Buenos Aires', pattern: /\bcaba\b|capital federal|ciudad aut[oó]noma/i },
  { province: 'Buenos Aires', pattern: /buenos aires|\bgba\b|conurbano|zona sur|zona norte|zona oeste/i },
  { province: 'Santa Fe', pattern: /santa fe|\brosario\b/i },
  { province: 'Mendoza', pattern: /\bmendoza\b/i },
  { province: 'Salta', pattern: /\bsalta\b/i },
  { province: 'Tucumán', pattern: /tucum[aá]n|\btuc\b/i },
  { province: 'Neuquén', pattern: /neuqu[eé]n/i },
  { province: 'Río Negro', pattern: /r[ií]o negro|bariloche|viedma/i },
  { province: 'Chubut', pattern: /\bchubut\b|trelew|comodoro|esquel/i },
  { province: 'Santa Cruz', pattern: /santa cruz|calafate|r[ií]o gallegos/i },
  { province: 'Tierra del Fuego', pattern: /tierra del fuego|ushuaia/i },
  { province: 'Entre Ríos', pattern: /entre r[ií]os|paran[aá]/i },
  { province: 'Corrientes', pattern: /corrientes/i },
  { province: 'Misiones', pattern: /misiones|posadas/i },
  { province: 'Chaco', pattern: /\bchaco\b|resistencia/i },
  { province: 'Formosa', pattern: /formosa/i },
  { province: 'Jujuy', pattern: /jujuy|san salvador de jujuy/i },
  { province: 'La Pampa', pattern: /la pampa|santa rosa/i },
  { province: 'La Rioja', pattern: /la rioja/i },
  { province: 'San Juan', pattern: /san juan/i },
  { province: 'San Luis', pattern: /san luis/i },
  { province: 'Santiago del Estero', pattern: /santiago del estero/i },
  { province: 'Catamarca', pattern: /catamarca/i },
];

/**
 * Local places / chains / campuses that imply a province even when the province
 * name is not written in the promo copy.
 */
const PLACE_ALIASES: Array<{ province: ArgentineProvince; pattern: RegExp }> = [
  // Santa Fe
  { province: 'Santa Fe', pattern: /alvear\s*super|super(?:mercados?)?\s*alvear/i },
  { province: 'Santa Fe', pattern: /\brosario\b|la capital\s*(?:super)?|liberti|tadicor|la yunta/i },
  // CABA / Buenos Aires metros
  { province: 'Ciudad Autónoma de Buenos Aires', pattern: /\buade\b|la cantina.*uade|uade.*cantina|utn\s*medrano|palermo\s*soho/i },
  { province: 'Buenos Aires', pattern: /mar del plata|la plata|quilmes|tigre|san isidro|lomas de zamora|banfield|avellaneda|mor[oó]n|ramos mej[ií]a|pilar|escobar|zarate|z[aá]rate/i },
  // Córdoba
  { province: 'Córdoba', pattern: /\bcba\b|villa allende|rio cuarto|r[ií]o cuarto|villa carlos paz/i },
  // Mendoza
  { province: 'Mendoza', pattern: /godoy cruz|luj[aá]n de cuyo|maip[uú]/i },
  // Tucumán
  { province: 'Tucumán', pattern: /san miguel de tucum[aá]n|yerba buena/i },
  // Neuquén / Río Negro
  { province: 'Neuquén', pattern: /cipolletti|plaza huincul|cutral\s*c[oó]/i },
  { province: 'Río Negro', pattern: /general roca|cipolletti|allen\b/i },
];

/** Infer provinces from promo copy. Empty = nacional / sin restricción geográfica declarada. */
export function inferPromotionProvinces(input: {
  title?: string | null;
  store?: string | null;
  where?: string | null;
  tags?: string | null;
  shortDescription?: string | null;
  details?: readonly string[] | null;
}): ArgentineProvince[] {
  const text = [
    input.title,
    input.store,
    input.where,
    input.tags,
    input.shortDescription,
    ...(input.details ?? []),
  ]
    .filter(Boolean)
    .join(' ');
  if (!text.trim()) return [];

  const found = new Set<ArgentineProvince>();
  for (const { province, pattern } of PROVINCE_ALIASES) {
    if (pattern.test(text)) found.add(province);
  }
  for (const { province, pattern } of PLACE_ALIASES) {
    if (pattern.test(text)) found.add(province);
  }

  if (found.size === 0 && NATIONAL_CHAIN_PATTERN.test(text)) return [];

  return [...found];
}

/** Promo visible in a province if it has no restriction or explicitly includes it. */
export function promotionMatchesProvince(
  promoProvinces: readonly string[],
  householdProvince: string | null | undefined,
): boolean {
  if (!householdProvince || promoProvinces.length === 0) return true;
  return promoProvinces.includes(householdProvince);
}
