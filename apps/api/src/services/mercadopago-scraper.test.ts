import { describe, expect, it } from 'vitest';
import {
  inferMercadoPagoCategory,
  isMercadoPagoPromoActive,
  normalizeMercadoPagoCard,
  parseMercadoPagoCap,
  parseMercadoPagoCards,
  parseMercadoPagoDiscount,
  parseMercadoPagoValidDates,
} from './mercadopago-scraper.js';

const SAMPLE_CARD_HTML = `
<div class="kiyo__cards--col 3148388  ">
  <div class="kiyo__data--details-logo-img">
    <img decoding="async" src="https://promociones.mercadopago.com.ar/wp-content/uploads/logo.jpg" alt="Farmacity" />
  </div>
  <h3>Farmacity</h3>
  <div class="kiyo__cards--badge"><span>2x1</span></div>
  <div class="kiyo__cards--badge kiyo__cards--badge2"><span>Hasta 3 cuotas sin interés</span></div>
  <h4>Promoción</h4>
  <p>¡Aprovechá el 2x1 acumulable con hasta 3 cuotas sin interés desde $70.000 en la tienda online!</p>
  <a href="https://promociones.mercadopago.com.ar/seller/farmacity/">Ir a la promoción</a>
  <h6>Legales</h6>
  <small>Válido del 13 al 17 de mayo</small>
</div>
<div class="kiyo__cards--col 3148794  ">
  <h3>Aerolíneas Argentinas</h3>
  <div class="kiyo__cards--badge"><span>Hasta 20% OFF</span></div>
  <h4>Promoción</h4>
  <p>¡Aprovechá 20% OFF con dinero en cuenta!</p>
  <a href="https://promociones.mercadopago.com.ar/seller/aerolineas-argentinas/">Ir</a>
  <h6>Legales</h6>
  <small>Válido del 14 al 17 de mayo. Tope de reintegro $30.000.</small>
</div>
`;

describe('parseMercadoPagoCards', () => {
  it('extracts cards from listing HTML', () => {
    const cards = parseMercadoPagoCards(SAMPLE_CARD_HTML);
    expect(cards).toHaveLength(2);
    expect(cards[0]).toMatchObject({
      externalId: '3148388',
      store: 'Farmacity',
      badges: ['2x1', 'Hasta 3 cuotas sin interés'],
      sourceUrl: 'https://promociones.mercadopago.com.ar/seller/farmacity/',
    });
  });
});

describe('parseMercadoPagoDiscount', () => {
  it('prioritizes percentage/2x1 over installments', () => {
    expect(parseMercadoPagoDiscount(['2x1', 'Hasta 3 cuotas sin interés'], '')).toEqual({
      kind: 'OTHER',
      label: '2x1',
      percentage: null,
    });
    expect(parseMercadoPagoDiscount(['Hasta 20% OFF', 'Hasta 12 cuotas sin interés'], '')).toMatchObject({
      kind: 'PERCENTAGE_REFUND',
      percentage: 20,
    });
  });
});

describe('parseMercadoPagoValidDates', () => {
  it('parses Spanish date ranges in the current year', () => {
    const now = new Date('2026-05-10T12:00:00Z');
    const { validFrom, validTo } = parseMercadoPagoValidDates('Válido del 11 al 17 de mayo', now);
    expect(validFrom).toContain('2026-05-11');
    expect(validTo).toContain('2026-05-17');
  });
});

describe('parseMercadoPagoCap', () => {
  it('extracts refund cap from legals', () => {
    expect(parseMercadoPagoCap(['Tope de reintegro $30.000.'])).toBe(30000);
  });
});

describe('inferMercadoPagoCategory', () => {
  it('maps known stores to seed categories', () => {
    expect(inferMercadoPagoCategory('Farmacity', 'tienda online')).toBe('Farmacia');
    expect(inferMercadoPagoCategory('VEA', 'supermercado')).toBe('Supermercado');
  });
});

describe('isMercadoPagoPromoActive', () => {
  it('rejects promos past validTo', () => {
    expect(
      isMercadoPagoPromoActive('2026-05-11T00:00:00.000Z', '2026-05-17T23:59:59.999Z', new Date('2026-06-01')),
    ).toBe(false);
  });
});

describe('normalizeMercadoPagoCard', () => {
  it('normalizes an active 2x1 promo with min purchase', () => {
    const cards = parseMercadoPagoCards(SAMPLE_CARD_HTML);
    const promo = normalizeMercadoPagoCard(cards[0]!, new Date('2026-05-14T12:00:00Z'));
    expect(promo).toMatchObject({
      externalId: '3148388',
      store: 'Farmacity',
      discountKind: 'OTHER',
      discountLabel: '2x1',
      categoryName: 'Farmacia',
      minPurchaseAmount: 70000,
      paymentFlow: 'online',
    });
    expect(promo?.details).toContain('Compra online');
  });

  it('normalizes percentage promo with cap', () => {
    const cards = parseMercadoPagoCards(SAMPLE_CARD_HTML);
    const promo = normalizeMercadoPagoCard(cards[1]!, new Date('2026-05-15T12:00:00Z'));
    expect(promo).toMatchObject({
      store: 'Aerolíneas Argentinas',
      discountKind: 'PERCENTAGE_REFUND',
      discountPercentage: 20,
      discountCap: 30000,
      categoryName: 'Transporte',
    });
  });

  it('returns null for expired promos', () => {
    const cards = parseMercadoPagoCards(SAMPLE_CARD_HTML);
    expect(normalizeMercadoPagoCard(cards[0]!, new Date('2026-07-01T12:00:00Z'))).toBeNull();
  });
});
