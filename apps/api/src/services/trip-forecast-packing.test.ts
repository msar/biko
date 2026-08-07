import { describe, expect, it } from 'vitest';
import {
  formatPackingChecklistLine,
  isPackingListTitle,
  packingChecklistTitles,
  PACKING_LIST_TITLE,
} from './trip-forecast.js';

describe('packing checklist helpers', () => {
  it('formats checklist lines', () => {
    expect(formatPackingChecklistLine('  Protector solar ')).toBe('☐ Protector solar');
  });

  it('parses checklist titles from notes', () => {
    const notes = ['☐ Documentos', '☑ Cargador', '- Paraguas', 'Campera'].join('\n');
    expect(packingChecklistTitles(notes)).toEqual([
      'Documentos',
      'Cargador',
      'Paraguas',
      'Campera',
    ]);
  });

  it('exposes the Keep-style packing list title', () => {
    expect(PACKING_LIST_TITLE).toBe('Lista para llevar');
  });

  it('matches current and legacy packing list titles', () => {
    expect(isPackingListTitle('Lista para llevar')).toBe(true);
    expect(isPackingListTitle('  Lista para traer  ')).toBe(true);
    expect(isPackingListTitle('Otra lista')).toBe(false);
  });
});
