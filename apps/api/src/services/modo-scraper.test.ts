import { describe, expect, it } from 'vitest';
import {
  buildPromoNotes,
  buildModoSourceUrl,
  extractBankNames,
  extractPromoDetails,
  extractStoreName,
  isModoPromoActive,
  normalizeCard,
  parseDaysOfWeek,
  parsePercentage,
  parseStoreFromTitle,
} from './modo-scraper.js';

describe('parseDaysOfWeek', () => {
  it('maps MODO day letters (X = miércoles)', () => {
    expect(parseDaysOfWeek('X')).toEqual(['WEDNESDAY']);
    expect(parseDaysOfWeek('VSD')).toEqual(['FRIDAY', 'SATURDAY', 'SUNDAY']);
  });

  it('all 7 days or empty means every day ([])', () => {
    expect(parseDaysOfWeek('LMXJVSD')).toEqual([]);
    expect(parseDaysOfWeek('LMXJSDV')).toEqual([]);
    expect(parseDaysOfWeek('')).toEqual([]);
    expect(parseDaysOfWeek(undefined)).toEqual([]);
  });
});

describe('parsePercentage', () => {
  it('accepts numbers and extracts from strings', () => {
    expect(parsePercentage(25)).toBe(25);
    expect(parsePercentage('30% de reintegro')).toBe(30);
    expect(parsePercentage('Hasta 12,5% off')).toBe(12.5);
  });

  it('rejects invalid values', () => {
    expect(parsePercentage('6 cuotas sin interés')).toBeNull();
    expect(parsePercentage(150)).toBeNull();
  });
});

describe('extractBankNames', () => {
  it('extracts all adherent banks from extra_data', () => {
    expect(
      extractBankNames([
        {
          text: 'Bancos adheridos',
          extra_data: [
            { name_bank: 'Banco Nación' },
            { name_bank: 'BBVA' },
            { name_bank: 'Santander' },
          ],
        },
      ]),
    ).toEqual(['Banco Nación', 'BBVA', 'Santander']);
  });
});

describe('extractPromoDetails', () => {
  it('includes adherent stores and gas station hints', () => {
    const details = extractPromoDetails({
      title: '10% en YPF',
      where: 'YPF',
      stores_whitelist: true,
      payment_flow: 'instore',
      content: { row: [{ text: '25% de reintegro' }, { text: 'Bancos adheridos' }] },
    });
    expect(details).toContain('Aplica en locales adheridos');
    expect(details).toContain('Compra presencial');
    expect(details).toContain('Estaciones de servicio adheridas');
  });
});

describe('normalizeCard', () => {
  const card = {
    id: '9a99b6e5-9f3a-4cd2-a8cd-328bac1678e6',
    promo_id: '2883db03-1481-48df-b908-3aed68d98c82',
    title: '25% en Oxford Polo Club',
    where: 'Oxford Polo Club',
    status: 'active',
    calculated_status: 'RUNNING',
    days_of_week: 'X',
    start_date: '2025-12-18T03:00:00.000Z',
    stop_date: '2026-12-25T02:59:59.999Z',
    slug: '25-comafi-oxford-polo-club',
    payment_flow: 'instore',
    content: {
      row: [
        { text: 'Oxford Polo Club' },
        { text: '25% de reintegro' },
        { text: 'Desde el 18/12 al 24/12' },
        { text: 'Exclusivo con ' },
        { text: '25000' },
        { text: 'Comafi', extra_data: [{ name_bank: 'Comafi' }] },
      ],
      image: { primary_image: 'https://example.com/logo.jpg' },
    },
  };

  it('normalizes a real-shaped card with visuals and details', () => {
    const promo = normalizeCard(card, 'Indumentaria');
    expect(promo).toMatchObject({
      externalId: '2883db03-1481-48df-b908-3aed68d98c82',
      store: 'Oxford Polo Club',
      categoryName: 'Indumentaria',
      bankNames: ['Comafi'],
      discountKind: 'PERCENTAGE_REFUND',
      discountLabel: '25% de reintegro',
      discountPercentage: 25,
      discountCap: 25000,
      daysOfWeek: ['WEDNESDAY'],
      imageUrl: 'https://example.com/logo.jpg',
      paymentFlow: 'instore',
    });
    expect(promo?.details).toContain('25% de reintegro');
    expect(promo?.details).toContain('Compra presencial');
    expect(promo?.sourceUrl).toBe('https://www.modo.com.ar/promos/25-comafi-oxford-polo-club');
  });

  it('imports installment promos with store name in title', () => {
    const promo = normalizeCard(
      {
        ...card,
        title: '6 cuotas sin interés',
        where: 'Megatone',
        content: { row: [{ text: 'Megatone' }, { text: '6 cuotas sin interés' }] },
      },
      null,
    );
    expect(promo?.discountKind).toBe('INSTALLMENTS');
    expect(promo?.store).toBe('Megatone');
    expect(promo?.title).toBe('6 cuotas sin interés en Megatone');
  });

  it('drops promos that are not running or expired', () => {
    expect(normalizeCard({ ...card, calculated_status: 'FINISHED' }, null)).toBeNull();
    expect(
      normalizeCard(
        { ...card, calculated_status: 'RUNNING', stop_date: '2020-01-01T00:00:00.000Z' },
        null,
        new Date(2026, 6, 1),
      ),
    ).toBeNull();
  });

  it('treats cap 0 as no cap and missing bank as MODO-wide', () => {
    const promo = normalizeCard(
      { ...card, content: { row: [{ text: '20% de reintegro' }, { text: '0' }] } },
      'Supermercado',
    );
    expect(promo?.discountCap).toBeNull();
    expect(promo?.bankNames).toEqual([]);
  });

  it('infers regional provinces from copy', () => {
    const promo = normalizeCard(
      {
        ...card,
        title: '30% en Gastronomía Salta',
        where: 'Comercios de Gastronomía de Salta adheridos',
        search_tags: 'gastronomia,salta',
      },
      'Restaurante',
    );
    expect(promo?.provinces).toContain('Salta');
  });
});

describe('store and active helpers', () => {
  it('builds promo URL without /landing/', () => {
    expect(buildModoSourceUrl('10-thefoodmarket-bbva-jul26')).toBe(
      'https://www.modo.com.ar/promos/10-thefoodmarket-bbva-jul26',
    );
  });

  it('parses store from title', () => {
    expect(parseStoreFromTitle('25% en Super La Yunta')).toBe('Super La Yunta');
  });

  it('builds notes with store when title is generic', () => {
    expect(buildPromoNotes('3 cuotas sin interés', 'MasOnline', '3 cuotas sin interés')).toBe(
      '3 cuotas sin interés en MasOnline',
    );
  });

  it('isModoPromoActive requires RUNNING or active status', () => {
    expect(isModoPromoActive({ calculated_status: 'RUNNING', status: 'active' })).toBe(true);
    expect(isModoPromoActive({ calculated_status: 'FINISHED', status: 'active' })).toBe(false);
    expect(isModoPromoActive({ status: 'paused' })).toBe(false);
  });

  it('extractStoreName prefers where over generic text', () => {
    expect(
      extractStoreName(
        { where: 'Cuesta Blanca', content: { row: [{ text: 'Cuesta Blanca' }, { text: '6 cuotas sin interés' }] } },
        '6 cuotas sin interés',
        ['Cuesta Blanca', '6 cuotas sin interés'],
      ),
    ).toBe('Cuesta Blanca');
  });
});
