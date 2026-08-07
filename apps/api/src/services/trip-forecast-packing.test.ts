import { describe, expect, it } from 'vitest';
import {
  buildPackingSuggestions,
  formatPackingChecklistLine,
  isPackingListTitle,
  isPackingSectionHeader,
  mergePackingChecklist,
  normalizePackingNotes,
  packingChecklistTitles,
  PACKING_LIST_TITLE,
  type TripForecastDaily,
} from './trip-forecast.js';
import {
  buildPackingCatalog,
  classifyClimate,
  classifyDestination,
  climateBandLabelEs,
} from './trip-packing-catalog.js';

function day(partial: Partial<TripForecastDaily> & { date: string }): TripForecastDaily {
  return {
    tMax: 22,
    tMin: 12,
    precipProb: 10,
    weatherCode: 1,
    uvIndexMax: 3,
    precipSum: 0,
    windSpeedMax: 10,
    ...partial,
  };
}

describe('packing checklist helpers', () => {
  it('formats checklist lines with * marker', () => {
    expect(formatPackingChecklistLine('  Protector solar ')).toBe('* Protector solar');
    expect(formatPackingChecklistLine('Protector solar', true)).toBe('* [x] Protector solar');
  });

  it('parses mixed markers and skips blank / empty checkbox lines', () => {
    const notes = [
      'Clima',
      '* Abrigo',
      '☐ Paraguas',
      '- [x] Gorra',
      '*',
      '☐',
      '',
      '* Para el viaje',
      '- Documentos',
      'Campera suelta',
    ].join('\n');
    expect(packingChecklistTitles(notes)).toEqual([
      'Abrigo',
      'Paraguas',
      'Gorra',
      'Documentos',
      'Campera suelta',
    ]);
    expect(isPackingSectionHeader('Clima')).toBe(true);
    expect(isPackingSectionHeader('* Para el viaje')).toBe(true);
    expect(isPackingSectionHeader('Para el viaje')).toBe(true);
    expect(isPackingSectionHeader('Destino')).toBe(true);
  });

  it('normalizes free-form notes to canonical * lines without orphan blanks', () => {
    const notes = [
      'Clima',
      '',
      '* Abrigo',
      '☐',
      '- Paraguas',
      '',
      'Para el viaje',
      '* [x] 3 mudas de ropa',
      'Documentos',
    ].join('\n');
    expect(normalizePackingNotes(notes)).toBe(
      [
        'Clima',
        '* Abrigo',
        '* Paraguas',
        '',
        'Para el viaje',
        '* [x] 3 mudas de ropa',
      ].join('\n'),
    );
  });

  it('exposes the Keep-style packing list title', () => {
    expect(PACKING_LIST_TITLE).toBe('Lista para llevar');
  });

  it('matches current and legacy packing list titles', () => {
    expect(isPackingListTitle('Lista para llevar')).toBe(true);
    expect(isPackingListTitle('  Lista para traer  ')).toBe(true);
    expect(isPackingListTitle('Otra lista')).toBe(false);
  });

  it('merges new titles into sectioned notes without duplicates or boilerplate', () => {
    const existing = ['Clima', '☐ Abrigo', '☑ Paraguas', '* Documentos'].join('\n');
    const merged = mergePackingChecklist(existing, [
      { title: 'Abrigo', section: 'clima' },
      { title: 'Gorra', section: 'clima' },
      { title: 'Traje de baño', section: 'destino' },
      { title: '3 mudas de ropa', section: 'viaje' },
      { title: 'Cargador', section: 'viaje' },
    ]);
    expect(merged).toBe(
      [
        'Clima',
        '* Abrigo',
        '* [x] Paraguas',
        '* Gorra',
        '',
        'Destino',
        '* Traje de baño',
        '',
        'Para el viaje',
        '* 3 mudas de ropa',
      ].join('\n'),
    );
  });

  it('creates sectioned notes from scratch', () => {
    const notes = mergePackingChecklist(null, [
      { title: 'Protector solar', section: 'clima' },
      { title: '3 mudas de ropa', section: 'viaje' },
    ]);
    expect(notes).toBe(
      ['Clima', '* Protector solar', '', 'Para el viaje', '* 3 mudas de ropa'].join('\n'),
    );
  });
});

describe('climate / destination classifiers', () => {
  it('classifies freezing and wet profiles', () => {
    const profile = classifyClimate([
      day({ date: '2026-07-01', tMin: -2, tMax: 1, precipProb: 80, weatherCode: 73, uvIndexMax: 2 }),
    ]);
    expect(profile?.band).toBe('freezing');
    expect(profile?.snowy).toBe(true);
    expect(climateBandLabelEs(profile!)).toMatch(/nieve|frío/i);
  });

  it('detects coastal and high-altitude destinations', () => {
    expect(
      classifyDestination({ name: 'Mar del Plata', query: 'playa Mar del Plata' }).coastal,
    ).toBe(true);
    expect(
      classifyDestination({ name: 'Cerro Catedral', query: 'sierra Bariloche', elevation: 890 })
        .mountain,
    ).toBe(true);
    expect(
      classifyDestination({ name: 'La Quiaca', elevation: 3442 }).highAltitude,
    ).toBe(true);
  });
});

describe('buildPackingSuggestions', () => {
  it('omits generic always-on boilerplate on short mild trips', () => {
    const suggestions = buildPackingSuggestions(
      [day({ date: '2026-08-10', tMin: 18, tMax: 24, precipProb: 5 })],
      1,
    );
    const titles = suggestions.map((s) => s.title.toLowerCase());
    expect(titles.some((t) => t.includes('documentos'))).toBe(false);
    expect(titles.some((t) => t.includes('cargador'))).toBe(false);
    expect(titles.some((t) => t.includes('medicamento'))).toBe(false);
    expect(titles.some((t) => t.includes('kit de aseo'))).toBe(false);
  });

  it('keeps mild multi-day trips non-empty', () => {
    const suggestions = buildPackingSuggestions(
      [day({ date: '2026-08-10', tMin: 14, tMax: 22, precipProb: 5 })],
      3,
    );
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions.some((s) => s.title.includes('mudas'))).toBe(true);
  });

  it('suggests cold-weather gear from low minima', () => {
    const suggestions = buildPackingSuggestions(
      [
        day({ date: '2026-08-10', tMin: 3, tMax: 11, precipProb: 20 }),
        day({ date: '2026-08-11', tMin: 4, tMax: 12, precipProb: 10 }),
      ],
      2,
    );
    const clima = suggestions.filter((s) => s.section === 'clima').map((s) => s.title);
    expect(clima).toContain('Abrigo');
    expect(clima).toContain('Buzo o polar');
    expect(suggestions.some((s) => s.title.includes('mudas'))).toBe(true);
  });

  it('suggests heat gear and rain cover when relevant', () => {
    const suggestions = buildPackingSuggestions(
      [
        day({
          date: '2026-01-10',
          tMin: 22,
          tMax: 34,
          precipProb: 55,
          weatherCode: 61,
          uvIndexMax: 9,
        }),
        day({
          date: '2026-01-11',
          tMin: 23,
          tMax: 33,
          precipProb: 60,
          weatherCode: 63,
          uvIndexMax: 8,
        }),
        day({
          date: '2026-01-12',
          tMin: 21,
          tMax: 32,
          precipProb: 50,
          weatherCode: 80,
          uvIndexMax: 9,
        }),
      ],
      3,
    );
    const titles = suggestions.map((s) => s.title);
    expect(titles).toContain('Protector solar');
    expect(titles).toContain('Botella de agua');
    expect(titles).toContain('Impermeable');
    expect(titles.some((t) => t.includes('Medicamento'))).toBe(false);
  });

  it('suggests snow gear for snow weather codes', () => {
    const suggestions = buildPackingSuggestions(
      [day({ date: '2026-07-01', tMin: -2, tMax: 2, precipProb: 70, weatherCode: 73 })],
      2,
    );
    const titles = suggestions.map((s) => s.title);
    expect(titles).toContain('Calzado para nieve');
    expect(titles).toContain('Campera de abrigo');
  });

  it('adds destination section for coastal names', () => {
    const { suggestions } = buildPackingCatalog(
      [day({ date: '2026-01-10', tMin: 20, tMax: 28, precipProb: 10, uvIndexMax: 7 })],
      3,
      { name: 'Pinamar', query: 'playa Pinamar' },
    );
    const destino = suggestions.filter((s) => s.section === 'destino').map((s) => s.title);
    expect(destino).toContain('Traje de baño');
    expect(destino).toContain('Toalla de playa o viaje');
  });

  it('adds altitude gear for high elevation', () => {
    const { suggestions } = buildPackingCatalog(
      [day({ date: '2026-08-10', tMin: 8, tMax: 18, precipProb: 15 })],
      3,
      { name: 'La Quiaca', elevation: 3442, query: 'La Quiaca' },
    );
    const destino = suggestions.filter((s) => s.section === 'destino');
    expect(destino.some((s) => s.title.includes('polar') || s.title.includes('capas'))).toBe(true);
    expect(destino.some((s) => s.title === 'Protector solar')).toBe(true);
  });

  it('scales clothing count with trip length (nights-based)', () => {
    const shortTrip = buildPackingSuggestions(
      [day({ date: '2026-08-10', tMin: 15, tMax: 22 })],
      4,
    );
    const longTrip = buildPackingSuggestions(
      [day({ date: '2026-08-10', tMin: 15, tMax: 22 })],
      10,
    );
    expect(shortTrip.some((s) => s.title === '3 mudas de ropa')).toBe(true);
    expect(longTrip.some((s) => s.title.includes('mudas de ropa'))).toBe(true);
    expect(longTrip.some((s) => s.title === 'Detergente de viaje')).toBe(true);
  });

  it('suggests sun gear from high UV even when not hot', () => {
    const suggestions = buildPackingSuggestions(
      [
        day({
          date: '2026-09-01',
          tMin: 6,
          tMax: 16,
          precipProb: 5,
          uvIndexMax: 8,
          weatherCode: 0,
        }),
      ],
      2,
    );
    expect(suggestions.some((s) => s.title === 'Protector solar')).toBe(true);
    expect(suggestions.some((s) => s.title === 'Anteojos de sol')).toBe(true);
  });
});
