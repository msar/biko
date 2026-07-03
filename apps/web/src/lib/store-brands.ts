/** Fallback logos for cadenas conocidas cuando no hay imageUrl de MODO. */
const BRAND_LOGOS: Record<string, string> = {
  changomas: 'https://assets.mobile.playdigital.com.ar/images/merchants/brands/ChangoMas.png',
  changomás: 'https://assets.mobile.playdigital.com.ar/images/merchants/brands/ChangoMas.png',
  carrefour: 'https://assets.mobile.playdigital.com.ar/images/merchants/brands/Carrefour.png',
  coto: 'https://assets.mobile.playdigital.com.ar/images/merchants/brands/Coto.png',
  jumbo: 'https://assets.mobile.playdigital.com.ar/images/merchants/brands/Jumbo.png',
  disco: 'https://assets.mobile.playdigital.com.ar/images/merchants/brands/Disco.png',
  vea: 'https://assets.mobile.playdigital.com.ar/images/merchants/brands/Vea.png',
  dia: 'https://assets.mobile.playdigital.com.ar/images/merchants/brands/Dia.png',
  'la anonima': 'https://assets.mobile.playdigital.com.ar/images/merchants/brands/LaAnonima.png',
  'la anónima': 'https://assets.mobile.playdigital.com.ar/images/merchants/brands/LaAnonima.png',
  ypf: 'https://assets.mobile.playdigital.com.ar/images/merchants/brands/YPF.png',
  shell: 'https://assets.mobile.playdigital.com.ar/images/merchants/brands/Shell.png',
  axion: 'https://assets.mobile.playdigital.com.ar/images/merchants/brands/Axion.png',
  farmacity: 'https://assets.mobile.playdigital.com.ar/images/merchants/brands/Farmacity.png',
};

function normalizeStoreName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function resolveStoreLogo(store: string | null | undefined, imageUrl: string | null | undefined): string | null {
  if (imageUrl) return imageUrl;
  if (!store) return null;
  const key = normalizeStoreName(store);
  for (const [brand, logo] of Object.entries(BRAND_LOGOS)) {
    if (key.includes(brand)) return logo;
  }
  return null;
}

export function storeDisplayName(store: string | null | undefined): string {
  if (!store) return 'Cualquier comercio';
  if (/consult/i.test(store)) return 'Locales adheridos';
  return store;
}
