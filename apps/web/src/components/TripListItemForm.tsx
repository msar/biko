import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Chip, IconButton } from './ui';
import { api } from '../lib/api';
import {
  appendPackingChecklistItem,
  isPackingListTitle,
  normalizeChecklistNotes,
  normalizePackingNotes,
  notesAreChecklist,
  PACKING_LIST_TITLE,
  packingChecklistProgress,
} from '../lib/packing-checklist';
import type { TripHub, TripListItemRow } from '../lib/trip-types';

export type TripListItemFormInitial = {
  type: 'TODO' | 'PACK' | 'BUY';
  title: string;
  notes: string;
  assignToAll: boolean;
  assigneeIds: string[];
};

export function initialFromTripListItem(item: TripListItemRow): TripListItemFormInitial {
  return {
    type: item.type,
    title: item.title,
    notes: item.notes ?? '',
    assignToAll: item.assignToAll,
    assigneeIds: item.assignees.map((m) => m.id),
  };
}

interface TripListItemFormProps {
  mode: 'create' | 'edit';
  trip: TripHub;
  itemId?: string;
  /** Existing items — used when folding a plain PACK title into Lista para llevar. */
  existingItems?: TripListItemRow[];
  initial?: TripListItemFormInitial;
  title: string;
  backTo: string;
}

export default function TripListItemForm({
  mode,
  trip,
  itemId,
  existingItems = [],
  initial,
  title: pageTitle,
  backTo,
}: TripListItemFormProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [itemType, setItemType] = useState<'TODO' | 'PACK' | 'BUY'>(initial?.type ?? 'TODO');
  const [title, setTitle] = useState(initial?.title ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [assignToAll, setAssignToAll] = useState(initial?.assignToAll ?? false);
  const [assigneeIds, setAssigneeIds] = useState<string[]>(initial?.assigneeIds ?? []);

  const createMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api<TripListItemRow>(`/trips/${trip.id}/list-items`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: ['trips', trip.id, 'list-items'] });
      navigate(`/viajes/${trip.id}/listas/${created.id}`, { replace: true });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ targetId, body }: { targetId: string; body: Record<string, unknown> }) =>
      api<TripListItemRow>(`/trips/${trip.id}/list-items/${targetId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    onSuccess: (updated) => {
      void queryClient.invalidateQueries({ queryKey: ['trips', trip.id, 'list-items'] });
      void queryClient.invalidateQueries({
        queryKey: ['trips', trip.id, 'list-items', updated.id],
      });
      void queryClient.invalidateQueries({
        queryKey: ['trips', trip.id, 'list-items', updated.id, 'activities'],
      });
      navigate(`/viajes/${trip.id}/listas/${updated.id}`, { replace: true });
    },
  });

  const toggleAssignee = (memberId: string) => {
    setAssignToAll(false);
    setAssigneeIds((prev) =>
      prev.includes(memberId) ? prev.filter((id) => id !== memberId) : [...prev, memberId],
    );
  };

  const busy = createMutation.isPending || updateMutation.isPending;
  const formError =
    (createMutation.isError && createMutation.error) ||
    (updateMutation.isError && updateMutation.error) ||
    null;

  const titlePlaceholder =
    itemType === 'TODO'
      ? 'Reservar auto'
      : itemType === 'PACK'
        ? PACKING_LIST_TITLE
        : 'Protector solar';
  const notesPlaceholder = '* Ítem por línea (opcional)';

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim() || trip.status === 'CLOSED') return;
    const trimmedTitle = title.trim();
    const trimmedNotes = notes.trim();
    const isPackingList =
      itemType === 'PACK' && (isPackingListTitle(trimmedTitle) || Boolean(trimmedNotes));
    const shouldNormalizeChecklist = isPackingList || notesAreChecklist(trimmedNotes);
    const normalizedNotes = shouldNormalizeChecklist
      ? (isPackingListTitle(trimmedTitle)
          ? normalizePackingNotes(notes)
          : normalizeChecklistNotes(notes)) || null
      : trimmedNotes || null;
    const body = {
      type: itemType,
      title: trimmedTitle,
      notes: normalizedNotes,
      assignToAll,
      assigneeMemberIds: assignToAll ? [] : assigneeIds,
    };

    if (mode === 'edit' && itemId) {
      updateMutation.mutate({ targetId: itemId, body });
      return;
    }

    // Fold plain "Llevar" titles into the shared packing checklist when it exists.
    if (itemType === 'PACK' && !isPackingListTitle(trimmedTitle)) {
      const packingList = existingItems.find(
        (i) => i.type === 'PACK' && isPackingListTitle(i.title),
      );
      if (packingList) {
        let nextNotes = appendPackingChecklistItem(packingList.notes, trimmedTitle);
        if (trimmedNotes) {
          for (const raw of trimmedNotes.split('\n')) {
            const line = raw.trim();
            if (!line) continue;
            nextNotes = appendPackingChecklistItem(nextNotes, line);
          }
        }
        if (nextNotes === (packingList.notes ?? '')) {
          navigate(`/viajes/${trip.id}/listas/${packingList.id}`, { replace: true });
          return;
        }
        const progress = packingChecklistProgress(nextNotes);
        updateMutation.mutate({
          targetId: packingList.id,
          body: {
            notes: nextNotes,
            ...(packingList.status === 'DONE' && progress.done < progress.total
              ? { status: 'PENDING' }
              : {}),
          },
        });
        return;
      }
    }

    createMutation.mutate(body);
  };

  return (
    <div className="page">
      <header className="page-header">
        <IconButton icon="arrow_back" label="Volver" onClick={() => navigate(backTo)} />
        <h1>{pageTitle}</h1>
        <span />
      </header>

      <form className="card promo-form" onSubmit={onSubmit}>
        <div className="segmented">
          <button
            type="button"
            className={itemType === 'TODO' ? 'active' : ''}
            onClick={() => setItemType('TODO')}
          >
            Hacer
          </button>
          <button
            type="button"
            className={itemType === 'PACK' ? 'active' : ''}
            onClick={() => setItemType('PACK')}
          >
            Llevar
          </button>
          <button
            type="button"
            className={itemType === 'BUY' ? 'active' : ''}
            onClick={() => setItemType('BUY')}
          >
            Comprar
          </button>
        </div>
        <label>
          {itemType === 'TODO' ? 'Qué hay que hacer' : 'Ítem'}
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={titlePlaceholder}
            autoFocus
          />
        </label>
        <label>
          Notas
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={notesPlaceholder}
            rows={itemType === 'PACK' ? 6 : 4}
          />
        </label>
        <div className="listas-assignees">
          <span className="listas-assignees-label">Asignar a</span>
          <div className="chip-row">
            <Chip
              selected={assignToAll}
              onClick={() => {
                setAssignToAll(true);
                setAssigneeIds([]);
              }}
            >
              Todos
            </Chip>
            {trip.members.map((m) => (
              <Chip
                key={m.id}
                selected={!assignToAll && assigneeIds.includes(m.id)}
                onClick={() => toggleAssignee(m.id)}
              >
                {m.displayName}
              </Chip>
            ))}
          </div>
          {!assignToAll && assigneeIds.length === 0 && (
            <span className="hint">Sin asignar</span>
          )}
        </div>
        <div className="listas-form-actions">
          <button type="submit" className="btn-primary" disabled={!title.trim() || busy}>
            {busy ? 'Guardando…' : mode === 'edit' ? 'Guardar' : 'Crear'}
          </button>
          <Link to={backTo} className="btn-link">
            Cancelar
          </Link>
        </div>
        {formError && (
          <p className="error" style={{ marginTop: 8 }}>
            {formError instanceof Error ? formError.message : 'No se pudo guardar'}
          </p>
        )}
      </form>
    </div>
  );
}
