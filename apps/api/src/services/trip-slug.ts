/** ASCII slug for shareable trip invite URLs. */

const COMBINING = /[\u0300-\u036f]/g;

export function slugifyTripName(name: string): string {
  const base = name
    .normalize('NFD')
    .replace(COMBINING, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return base || 'viaje';
}

export function tripSlugBase(name: string, startDate?: Date | null): string {
  const slug = slugifyTripName(name);
  if (!startDate || Number.isNaN(startDate.getTime())) return slug;
  const year = startDate.getFullYear();
  if (!slug.endsWith(`-${year}`)) return `${slug}-${year}`.slice(0, 56);
  return slug.slice(0, 56);
}

export async function allocateUniqueShareSlug(
  exists: (slug: string) => Promise<boolean>,
  name: string,
  startDate?: Date | null,
): Promise<string> {
  const base = tripSlugBase(name, startDate);
  if (!(await exists(base))) return base;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base}-${i}`.slice(0, 64);
    if (!(await exists(candidate))) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`.slice(0, 64);
}
