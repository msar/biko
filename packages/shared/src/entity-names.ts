/** Normaliza nombres de banco/entidad para comparar MODO vs catálogo seed. */
export function normalizeEntityName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/^banco\s+/i, '')
    .trim()
    .toLowerCase();
}

const ENTITY_ALIASES: Record<string, string> = {
  nacion: 'nación',
  'banco nacion': 'nación',
  'banco nación': 'nación',
  'naranja x': 'naranja x',
  'mercado pago': 'mercadopago',
  'mercadopago': 'mercadopago',
  'banco provincia': 'provincia',
  provincia: 'provincia',
  'banco ciudad': 'ciudad',
  ciudad: 'ciudad',
  'banco hipotecario': 'hipotecario',
  hipotecario: 'hipotecario',
  'banco santa fe': 'banco santa fe',
  'santa fe': 'banco santa fe',
  'banco san juan': 'banco san juan',
  'banco columbia': 'banco columbia',
};

export function canonicalEntityName(name: string): string {
  const key = normalizeEntityName(name);
  return ENTITY_ALIASES[key] ?? key;
}

export function entityNamesMatch(a: string, b: string): boolean {
  const ca = canonicalEntityName(a);
  const cb = canonicalEntityName(b);
  if (ca === cb) return true;
  return ca.includes(cb) || cb.includes(ca);
}

/** Mapea nombre de banco de MODO al nombre en el catálogo seed. */
export function mapModoBankToCatalogName(bankName: string): string {
  const canonical = canonicalEntityName(bankName);
  const catalogNames: Record<string, string> = {
    nación: 'Nación',
    santander: 'Santander',
    bbva: 'BBVA',
    galicia: 'Galicia',
    macro: 'Macro',
    icbc: 'ICBC',
    provincia: 'Provincia',
    comafi: 'Comafi',
    credicoop: 'Credicoop',
    supervielle: 'Supervielle',
    ciudad: 'Ciudad',
    'banco santa fe': 'Banco Santa Fe',
    'santa fe': 'Banco Santa Fe',
    hipotecario: 'Hipotecario',
    'banco san juan': 'Banco San Juan',
    'banco columbia': 'Banco Columbia',
    modo: 'MODO',
  };
  return catalogNames[canonical] ?? bankName.replace(/^Banco\s+/i, '').trim();
}
