import { describe, expect, it } from 'vitest';
import {
  formatPackingChecklistLine,
  normalizeChecklistNotes,
  normalizePackingNotes,
  notesAreChecklist,
  packingChecklistProgress,
  packingChecklistTitles,
  parsePackingChecklist,
  togglePackingChecklistLine,
} from './packing-checklist';

describe('packing-checklist', () => {
  it('parses * / - / ☐ / task-box lines and section headers', () => {
    const notes = [
      'Clima',
      '* Abrigo',
      '- [ ] Paraguas',
      '☐ Gorra',
      '* [x] Anteojos',
      '',
      'Para el viaje',
      '*',
      '☐',
      '* 3 mudas de ropa',
    ].join('\n');

    expect(parsePackingChecklist(notes)).toEqual([
      { kind: 'section', section: 'clima', label: 'Clima' },
      { kind: 'item', title: 'Abrigo', checked: false, lineIndex: 1 },
      { kind: 'item', title: 'Paraguas', checked: false, lineIndex: 2 },
      { kind: 'item', title: 'Gorra', checked: false, lineIndex: 3 },
      { kind: 'item', title: 'Anteojos', checked: true, lineIndex: 4 },
      { kind: 'section', section: 'viaje', label: 'Para el viaje' },
      { kind: 'item', title: '3 mudas de ropa', checked: false, lineIndex: 9 },
    ]);
    expect(packingChecklistTitles(notes)).toEqual([
      'Abrigo',
      'Paraguas',
      'Gorra',
      'Anteojos',
      '3 mudas de ropa',
    ]);
    expect(packingChecklistProgress(notes)).toEqual({ done: 1, total: 5 });
  });

  it('detects marked checklist notes for any list item', () => {
    expect(notesAreChecklist('* Lechuga\n* Tomate\n* Aceituna')).toBe(true);
    expect(notesAreChecklist('- Juegos\n☐ Pimiento')).toBe(true);
    expect(notesAreChecklist('Comprar en el súper\ny también pan')).toBe(false);
    expect(notesAreChecklist('solo una línea')).toBe(false);
    expect(notesAreChecklist('')).toBe(false);
  });

  it('treats bulleted section labels as headers, not empty-ish items', () => {
    const notes = ['* Clima', '* Abrigo', '- Para el viaje', '* Muda'].join('\n');
    expect(parsePackingChecklist(notes).filter((e) => e.kind === 'section')).toEqual([
      { kind: 'section', section: 'clima', label: 'Clima' },
      { kind: 'section', section: 'viaje', label: 'Para el viaje' },
    ]);
  });

  it('normalizes typed notes to canonical * format', () => {
    expect(normalizeChecklistNotes('☐ Abrigo\n\n* Paraguas\n☐\n')).toBe(
      ['* Abrigo', '* Paraguas'].join('\n'),
    );
    expect(normalizePackingNotes('Clima\n☐ Abrigo\n\n* Paraguas\n☐\n')).toBe(
      ['Clima', '* Abrigo', '* Paraguas'].join('\n'),
    );
  });

  it('toggles * lines in place', () => {
    const notes = ['Clima', '* Abrigo', '* Paraguas'].join('\n');
    const next = togglePackingChecklistLine(notes, 1);
    expect(next).toBe(['Clima', '* [x] Abrigo', '* Paraguas'].join('\n'));
    expect(togglePackingChecklistLine(next, 1)).toBe(notes);
  });

  it('formats checklist lines', () => {
    expect(formatPackingChecklistLine('Gorra')).toBe('* Gorra');
    expect(formatPackingChecklistLine('Gorra', true)).toBe('* [x] Gorra');
  });
});
