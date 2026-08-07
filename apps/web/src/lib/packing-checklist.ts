/** Keep-style packing checklist helpers (mirrors API packing notes format). */

export const PACKING_LIST_TITLE = 'Lista para llevar';
export const PACKING_LIST_TITLE_LEGACY = 'Lista para traer';

export type PackingSection = 'clima' | 'destino' | 'viaje';

export const PACKING_SECTION_LABELS: Record<PackingSection, string> = {
  clima: 'Clima',
  destino: 'Destino',
  viaje: 'Para el viaje',
};

const SECTION_LABEL_TO_KEY = new Map<string, PackingSection>(
  (Object.entries(PACKING_SECTION_LABELS) as Array<[PackingSection, string]>).map(
    ([key, label]) => [label.toLowerCase(), key],
  ),
);

/**
 * Canonical nested checklist line:
 *   `* Item` / `* [x] Item`
 * Also accepted on parse: `- Item`, `☐/☑ Item`, `- [ ] Item`, `• Item`, etc.
 */
const TASK_BOX = /^\[\s*([xX✓☑]|)\s*\]\s*/;
const BULLET_MARK = /^[☐☑✓✗xX•\-*]\s+/;

export function isPackingListTitle(title: string): boolean {
  const key = title.trim().toLowerCase();
  return (
    key === PACKING_LIST_TITLE.toLowerCase() ||
    key === PACKING_LIST_TITLE_LEGACY.toLowerCase()
  );
}

export function isPackingSectionHeader(line: string): boolean {
  return SECTION_LABEL_TO_KEY.has(stripChecklistMarkup(line).toLowerCase());
}

export function formatPackingChecklistLine(title: string, checked = false): string {
  const clean = title.trim();
  return checked ? `* [x] ${clean}` : `* ${clean}`;
}

/** Strip leading checklist markers; returns remaining title text. */
export function stripChecklistMarkup(line: string): string {
  let rest = line.trim();
  if (!rest) return '';
  // Orphan markers like `*` / `☐` / `-` with no label.
  if (/^[-*•☐☑✓✗]+$/.test(rest)) return '';

  // `- [ ] Title` / `* [x] Title` / `[ ] Title`
  const bullet = rest.match(/^[-*•]\s+/);
  if (bullet) {
    rest = rest.slice(bullet[0].length);
  } else if (/^[☐☑✓✗]\s*/.test(rest)) {
    rest = rest.replace(/^[☐☑✓✗]\s*/, '');
  }

  const box = rest.match(TASK_BOX);
  if (box) {
    rest = rest.slice(box[0].length);
  }

  return rest.trim();
}

function isCheckedLine(line: string): boolean {
  const trimmed = line.trim();
  if (/^[☑✓]/.test(trimmed)) return true;
  if (/^[-*•]\s+\[\s*[xX✓☑]\s*\]/.test(trimmed)) return true;
  if (/^\[\s*[xX✓☑]\s*\]/.test(trimmed)) return true;
  return false;
}

export function looksLikeChecklistItem(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (/^[☐☑✓✗]/.test(trimmed)) return true;
  if (/^[-*•]\s+/.test(trimmed)) return true;
  if (TASK_BOX.test(trimmed)) return true;
  return false;
}

/**
 * True when notes contain at least one marked checklist line (`* Item`, `- Item`,
 * `☐ Item`, `[ ] Item`, etc.). Plain prose / unmarked lines alone do not qualify.
 */
export function notesAreChecklist(notes: string | null | undefined): boolean {
  if (!notes?.trim()) return false;
  for (const raw of notes.split('\n')) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (looksLikeChecklistItem(trimmed) && stripChecklistMarkup(trimmed)) return true;
  }
  return false;
}

export type PackingChecklistEntry =
  | { kind: 'section'; section: PackingSection; label: string }
  | { kind: 'item'; title: string; checked: boolean; lineIndex: number };

/** Parse notes into renderable checklist entries (section headers + items). */
export function parsePackingChecklist(notes: string | null | undefined): PackingChecklistEntry[] {
  if (!notes?.trim()) return [];
  const entries: PackingChecklistEntry[] = [];
  const lines = notes.split('\n');

  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i]!.trim();
    if (!trimmed) continue;

    const title = stripChecklistMarkup(trimmed);
    if (!title) continue;

    const section = SECTION_LABEL_TO_KEY.get(title.toLowerCase());
    if (section) {
      // Section headers are text-only — even if typed with a bullet/checkbox.
      entries.push({
        kind: 'section',
        section,
        label: PACKING_SECTION_LABELS[section],
      });
      continue;
    }

    if (looksLikeChecklistItem(trimmed) || BULLET_MARK.test(trimmed) || TASK_BOX.test(trimmed)) {
      entries.push({
        kind: 'item',
        title,
        checked: isCheckedLine(trimmed),
        lineIndex: i,
      });
      continue;
    }

    // Legacy unmarked item line (not a known section header)
    entries.push({
      kind: 'item',
      title,
      checked: false,
      lineIndex: i,
    });
  }

  return entries;
}

export function packingChecklistTitles(notes: string | null | undefined): string[] {
  return parsePackingChecklist(notes)
    .filter((e): e is Extract<PackingChecklistEntry, { kind: 'item' }> => e.kind === 'item')
    .map((e) => e.title);
}

export function packingChecklistProgress(notes: string | null | undefined): {
  done: number;
  total: number;
} {
  const items = parsePackingChecklist(notes).filter(
    (e): e is Extract<PackingChecklistEntry, { kind: 'item' }> => e.kind === 'item',
  );
  return {
    done: items.filter((i) => i.checked).length,
    total: items.length,
  };
}

const LEGACY_PACKING_BOILERPLATE = new Set([
  'documentos',
  'cargador',
  'medicamentos básicos',
  'medicamentos basicos',
]);

/**
 * Normalize free-form notes (one item per line, optional `*` / `-` / `☐`) into the
 * canonical nested checklist format (`* Item` / `* [x] Item`).
 */
export function normalizeChecklistNotes(notes: string | null | undefined): string {
  if (!notes?.trim()) return '';

  const lines: string[] = [];
  let lastWasItem = false;

  for (const raw of notes.split('\n')) {
    const trimmed = raw.trim();
    if (!trimmed) continue;

    const title = stripChecklistMarkup(trimmed);
    if (!title) continue;

    const section = SECTION_LABEL_TO_KEY.get(title.toLowerCase());
    if (section) {
      if (lines.length > 0 && lastWasItem) lines.push('');
      lines.push(PACKING_SECTION_LABELS[section]);
      lastWasItem = false;
      continue;
    }

    lines.push(formatPackingChecklistLine(title, isCheckedLine(trimmed)));
    lastWasItem = true;
  }

  return lines.join('\n');
}

/**
 * Like {@link normalizeChecklistNotes}, but also drops legacy packing boilerplate
 * titles that older weather suggestion builds always included.
 */
export function normalizePackingNotes(notes: string | null | undefined): string {
  if (!notes?.trim()) return '';

  const lines: string[] = [];
  let lastWasItem = false;

  for (const raw of notes.split('\n')) {
    const trimmed = raw.trim();
    if (!trimmed) continue;

    const title = stripChecklistMarkup(trimmed);
    if (!title) continue;

    const section = SECTION_LABEL_TO_KEY.get(title.toLowerCase());
    if (section) {
      if (lines.length > 0 && lastWasItem) lines.push('');
      lines.push(PACKING_SECTION_LABELS[section]);
      lastWasItem = false;
      continue;
    }

    if (LEGACY_PACKING_BOILERPLATE.has(title.toLowerCase())) continue;

    lines.push(formatPackingChecklistLine(title, isCheckedLine(trimmed)));
    lastWasItem = true;
  }

  return lines.join('\n');
}

/** Toggle checked state for the checklist item at lineIndex; returns updated notes. */
export function togglePackingChecklistLine(
  notes: string | null | undefined,
  lineIndex: number,
): string {
  const lines = (notes ?? '').split('\n');
  const line = lines[lineIndex];
  if (line == null) return notes ?? '';

  const trimmed = line.trim();
  if (!trimmed) return notes ?? '';

  const title = stripChecklistMarkup(trimmed);
  if (!title || isPackingSectionHeader(title)) return notes ?? '';

  const nextChecked = !isCheckedLine(trimmed);
  const indent = line.match(/^\s*/)?.[0] ?? '';
  lines[lineIndex] = `${indent}${formatPackingChecklistLine(title, nextChecked)}`;
  return lines.join('\n');
}
