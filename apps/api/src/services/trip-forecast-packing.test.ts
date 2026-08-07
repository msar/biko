import { describe, expect, it } from 'vitest';
import {
  formatPackingChecklistLine,
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
    expect(PACKING_LIST_TITLE).toBe('Lista para traer');
  });
});
