import { describe, expect, it } from 'vitest';
import {
  inferGaliciaAudience,
  normalizeGaliciaPromo,
  parseGaliciaDays,
} from './galicia-scraper.js';
import {
  inferSantanderAudience,
  normalizeSantanderOffer,
  parseSantanderDays,
} from './santander-scraper.js';

describe('santander scraper', () => {
  it('parses day lists', () => {
    expect(parseSantanderDays(['lunes', 'miércoles'])).toEqual(['MONDAY', 'WEDNESDAY']);
    expect(parseSantanderDays('LMXJVSD')).toEqual([]);
  });

  it('tags Sorpresa and Select audiences', () => {
    expect(inferSantanderAudience({ exclusiveCode: 'SOR', title: '20% Super' })).toEqual(['SANTANDER_SORPRESA']);
    expect(inferSantanderAudience({ exclusiveCodes: ['SEC'], title: 'Select 15%' })).toEqual(['SANTANDER_SELECT']);
    expect(inferSantanderAudience({ categories: [{ code: 'SEC', description: 'Select' }], title: '10%' })).toEqual([
      'SANTANDER_SELECT',
    ]);
    expect(inferSantanderAudience({ title: '10% general' })).toEqual([]);
  });

  it('normalizes a BFF publication payload', () => {
    const promo = normalizeSantanderOffer({
      id: 1616,
      idPromotion: 6679,
      customerDiscount: 30,
      topAmount: 15000,
      wednesday: true,
      monday: false,
      tuesday: false,
      thursday: false,
      friday: false,
      saturday: false,
      sunday: false,
      texts: { title: '30% de ahorro', description: 'Tope $15.000' },
      additionalText: '<p>Exclusivo para clientes Santander Select.</p>',
      brands: [{ id: 245, name: 'Jumbo', desktopImage: 'https://example.com/jumbo.png' }],
      categories: [{ code: 'SUP', description: 'Supermercado' }],
      startDatePublication: '2024-05-06T00:00:00',
      endDatePublication: '2099-09-30T00:00:00',
    });
    expect(promo).toMatchObject({
      externalId: '6679',
      store: 'Jumbo',
      discountPercentage: 30,
      discountCap: 15000,
      daysOfWeek: ['WEDNESDAY'],
      audienceSegments: ['SANTANDER_SELECT'],
      categoryName: 'Supermercado',
    });
  });

  it('normalizes a general benefit and a Sorpresa exclusive', () => {
    const general = normalizeSantanderOffer({
      id: 'gen-1',
      title: '25% en Carrefour',
      store: 'Carrefour',
      percentage: 25,
      cap: 10000,
      daysOfWeek: ['jueves'],
      channel: 'presencial',
    });
    expect(general).toMatchObject({
      externalId: 'gen-1',
      store: 'Carrefour',
      discountPercentage: 25,
      audienceSegments: [],
      paymentFlow: 'instore',
      bankNames: ['Santander'],
    });

    const sorpresa = normalizeSantanderOffer({
      id: 'sor-1',
      title: '40% Sorpresa en Farmacity',
      store: 'Farmacity',
      exclusiveCode: 'SOR',
      percentage: 40,
      description: 'Solo suscriptos a Sorpresa',
    });
    expect(sorpresa?.audienceSegments).toEqual(['SANTANDER_SORPRESA']);
    expect(sorpresa?.details).toContain('Requiere Sorpresa Santander');
  });
});

describe('galicia scraper', () => {
  it('parses days and Eminent audience', () => {
    expect(parseGaliciaDays(['viernes', 'sábado'])).toEqual(['FRIDAY', 'SATURDAY']);
    expect(inferGaliciaAudience({ modeloAtencion: 'EMINENT', titulo: '30% sushi' })).toEqual(['GALICIA_EMINENT']);
    expect(inferGaliciaAudience({ titulo: '10% general' })).toEqual([]);
  });

  it('normalizes Galicia and Eminent promos with province hints', () => {
    const open = normalizeGaliciaPromo({
      idPromocion: 99,
      titulo: '20% en Changomás',
      marca: { nombre: 'ChangoMás' },
      porcentajeReintegro: 20,
      topeReintegro: 8000,
      canal: 'presencial',
    });
    expect(open).toMatchObject({
      externalId: '99',
      store: 'ChangoMás',
      discountPercentage: 20,
      audienceSegments: [],
      paymentFlow: 'instore',
    });

    const eminent = normalizeGaliciaPromo({
      id: 'em-1',
      titulo: '30% gastronomía Eminent',
      marca: 'Osaka',
      porcentaje: 30,
      ModeloAtencion: 'EMINENT',
      provincia: 'Córdoba',
    });
    expect(eminent?.audienceSegments).toEqual(['GALICIA_EMINENT']);
    expect(eminent?.provinces).toContain('Córdoba');
    expect(eminent?.details).toContain('Requiere Galicia Eminent');
  });
});
