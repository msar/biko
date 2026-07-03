import { describe, expect, it } from 'vitest';
import {
  buildNaranjaXSourceUrl,
  currentNxPlans,
  isNaranjaXPromoActive,
  mapNxCategory,
  normalizeBinder,
  normalizeFeatured,
  parseNxDate,
  parseNxDaysOfWeek,
  parseNxDiscountCap,
} from './naranjax-scraper.js';

const pedidosYaBinder = {
  id: '2eebe48c-9beb-4070-9d77-16600020b7a1',
  commerceName: 'Pedidos Ya',
  title: '25% de reintegro',
  subtitle: 'En Pedidos Ya, ingresá y encontrá más beneficios.',
  backgroundImage: 'https://promotion-featured-images.naranjax.com/categories/gastronomia/comida_rapida/comida_rapida_1.webp',
  fullUrl: 'https://www.naranjax.com/promociones/GASTRONOMIA/COMIDA_RAPIDA/pedidos_ya_comercio',
  category: { key: 'GASTRONOMIA', name: 'Gastronomía', subcategory: { key: 'COMIDA_RAPIDA', name: 'Comida rapida' } },
  tags: [
    { type: 'refund', description: '$ 4.000, por persona, por mes' },
    { type: 'days', description: 'Los Viernes' },
  ],
  plans: [
    {
      status: 'CURRENT',
      ephemeris: { description: 'Exclusiva Épico', url: 'exclusiva-epico' },
      days: {
        dateFrom: '03/07/2026',
        dateTo: '03/07/2026',
        weekdaysApplied: [5],
        datesDescription: 'Desde: 03/JUL al 03/JUL',
      },
      promotionDetails: { appliesOnline: true },
      captureMethods: [{ key: 'app', extra: { name: 'Pedidos Ya' } }],
    },
    {
      status: 'EXPIRED',
      days: { dateFrom: '01/01/2025', dateTo: '01/01/2025', weekdaysApplied: [1] },
    },
  ],
};

describe('parseNxDate', () => {
  it('parses DD/MM/YYYY dates', () => {
    expect(parseNxDate('03/07/2026', 'from')).toBe(new Date(2026, 6, 3).toISOString());
    const end = parseNxDate('03/07/2026', 'to')!;
    expect(new Date(end).getHours()).toBe(23);
  });

  it('extends ISO dateTo through the Argentina calendar day', () => {
    const end = parseNxDate('2026-07-03T03:00:00.000Z', 'to')!;
    expect(new Date(end).toISOString()).toBe('2026-07-04T02:59:59.999Z');
  });

  it('rejects invalid dates', () => {
    expect(parseNxDate('not-a-date')).toBeNull();
    expect(parseNxDate('')).toBeNull();
  });
});

describe('parseNxDaysOfWeek', () => {
  it('maps Naranja X weekday ids to DayOfWeek', () => {
    expect(parseNxDaysOfWeek([5])).toEqual(['FRIDAY']);
    expect(parseNxDaysOfWeek([1, 3, 5])).toEqual(['MONDAY', 'WEDNESDAY', 'FRIDAY']);
  });

  it('all 7 days means every day ([])', () => {
    expect(parseNxDaysOfWeek([1, 2, 3, 4, 5, 6, 7])).toEqual([]);
  });
});

describe('mapNxCategory', () => {
  it('maps known Naranja X categories to seed names', () => {
    expect(mapNxCategory('SUPERMERCADOS')).toBe('Supermercado');
    expect(mapNxCategory('GASTRONOMIA')).toBe('Restaurante');
    expect(mapNxCategory('VIAJES_Y_TURISMO')).toBeNull();
  });
});

describe('parseNxDiscountCap', () => {
  it('extracts refund cap from refund tags', () => {
    expect(parseNxDiscountCap(pedidosYaBinder.tags)).toBe(4000);
  });
});

describe('currentNxPlans', () => {
  it('keeps only CURRENT plans', () => {
    expect(currentNxPlans(pedidosYaBinder.plans)).toHaveLength(1);
  });
});

describe('isNaranjaXPromoActive', () => {
  it('checks valid date range', () => {
    const now = new Date('2026-07-03T12:00:00Z');
    expect(
      isNaranjaXPromoActive(
        parseNxDate('03/07/2026', 'from'),
        parseNxDate('03/07/2026', 'to'),
        now,
      ),
    ).toBe(true);
    expect(
      isNaranjaXPromoActive(
        parseNxDate('01/07/2026', 'from'),
        parseNxDate('02/07/2026', 'to'),
        now,
      ),
    ).toBe(false);
  });
});

describe('buildNaranjaXSourceUrl', () => {
  it('prefers fullUrl and falls back to slug', () => {
    expect(buildNaranjaXSourceUrl('https://www.naranjax.com/promociones/foo', null)).toContain('/promociones/foo');
    expect(buildNaranjaXSourceUrl(null, 'GASTRONOMIA/pedidos_ya')).toContain('GASTRONOMIA/pedidos_ya');
  });
});

describe('normalizeBinder', () => {
  it('normalizes an active binder with store, link and Friday schedule', () => {
    const now = new Date('2026-07-03T12:00:00Z');
    const promo = normalizeBinder(pedidosYaBinder, now);
    expect(promo).toMatchObject({
      externalId: pedidosYaBinder.id,
      store: 'Pedidos Ya',
      categoryName: 'Restaurante',
      discountPercentage: 25,
      discountCap: 4000,
      daysOfWeek: ['FRIDAY'],
      paymentFlow: 'online',
      sourceUrl: pedidosYaBinder.fullUrl,
    });
    expect(promo?.details).toContain('Exclusiva Épico');
    expect(promo?.details).toContain('$ 4.000, por persona, por mes');
  });

  it('returns null when no CURRENT plans remain', () => {
    const promo = normalizeBinder({ ...pedidosYaBinder, plans: [{ status: 'EXPIRED' }] });
    expect(promo).toBeNull();
  });
});

describe('normalizeFeatured', () => {
  it('imports featured cards with promo links', () => {
    const promo = normalizeFeatured(
      {
        id: '01KW2S68PWKTE5VJMRCSGZMC96',
        title: 'Hasta 30% OFF',
        clarification: 'Con Plan Épico',
        commerceNameOrCategory: 'PedidosYa',
        link: 'https://www.naranjax.com/promociones/GASTRONOMIA/COMIDA_RAPIDA/pedidos_ya/exclusiva-epico',
        dateFrom: '2026-07-03T03:00:00.000Z',
        dateTo: '2026-07-03T03:00:00.000Z',
        validity: 'Viernes 3 de julio',
      },
      new Date('2026-07-03T12:00:00Z'),
    );
    expect(promo?.externalId).toBe('featured:01KW2S68PWKTE5VJMRCSGZMC96');
    expect(promo?.discountPercentage).toBe(30);
    expect(promo?.sourceUrl).toContain('naranjax.com/promociones');
  });

  it('skips non-promo featured links', () => {
    expect(
      normalizeFeatured({
        id: 'whatsapp',
        title: 'Sumate a nuestro canal',
        link: 'https://whatsapp.com/channel/foo',
        dateFrom: '2026-06-22T03:00:00.000Z',
        dateTo: '2026-07-31T03:00:00.000Z',
      }),
    ).toBeNull();
  });
});
