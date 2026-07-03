/** Etiqueta del link a la fuente original según el dominio de la promo. */
export function promoDetailsLinkLabel(sourceUrl: string | null | undefined): string {
  if (!sourceUrl) return 'Ver detalles';
  if (/naranjax\.com/i.test(sourceUrl)) return 'Ver detalles en NX';
  if (/modo\.com\.ar/i.test(sourceUrl)) return 'Ver detalles en MODO';
  if (/mercadopago\.com/i.test(sourceUrl)) return 'Ver detalles en Mercado Pago';
  return 'Ver detalles';
}
