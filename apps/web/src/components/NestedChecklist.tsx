import { useState } from 'react';
import {
  packingChecklistProgress,
  parsePackingChecklist,
} from '../lib/packing-checklist';

/** Nested Keep-style checklist rendered from item notes (PACK / BUY / TODO alike). */
export default function NestedChecklist({
  notes,
  metaLabel,
  closed,
  busy,
  onToggleLine,
  onAddItem,
}: {
  notes: string;
  metaLabel?: string | null;
  closed: boolean;
  busy?: boolean;
  onToggleLine: (lineIndex: number) => void;
  onAddItem?: (title: string) => void;
}) {
  const entries = parsePackingChecklist(notes);
  const progress = packingChecklistProgress(notes);
  const [draft, setDraft] = useState('');
  const canAdd = Boolean(onAddItem) && !closed;
  const isBusy = Boolean(busy);

  const submitDraft = () => {
    const title = draft.trim();
    if (!title || isBusy || !onAddItem) return;
    onAddItem(title);
    setDraft('');
  };

  return (
    <div className="listas-checklist">
      {(metaLabel || progress.total > 0) && (
        <div className="listas-checklist-meta">
          {[metaLabel, progress.total > 0 ? `${progress.done}/${progress.total} listos` : null]
            .filter(Boolean)
            .join(' · ')}
        </div>
      )}
      <div className="listas-checklist-list">
        {entries.map((entry, idx) => {
          if (entry.kind === 'section') {
            return (
              <div key={`section-${entry.section}-${idx}`} className="listas-checklist-section">
                {entry.label}
              </div>
            );
          }
          return (
            <div key={`${entry.lineIndex}-${entry.title}`} className="listas-checklist-line">
              <label className={entry.checked ? 'listas-checklist-line-done' : undefined}>
                <input
                  type="checkbox"
                  checked={entry.checked}
                  disabled={closed || isBusy}
                  onChange={() => onToggleLine(entry.lineIndex)}
                />
                <span>{entry.title}</span>
              </label>
            </div>
          );
        })}
      </div>
      {canAdd && (
        <form
          className="listas-checklist-add"
          onSubmit={(e) => {
            e.preventDefault();
            submitDraft();
          }}
        >
          <input
            type="text"
            value={draft}
            disabled={isBusy}
            placeholder="Agregar ítem"
            aria-label="Agregar ítem a la lista"
            onChange={(e) => setDraft(e.target.value)}
          />
          <button type="submit" className="btn-link" disabled={isBusy || !draft.trim()}>
            Agregar
          </button>
        </form>
      )}
    </div>
  );
}
