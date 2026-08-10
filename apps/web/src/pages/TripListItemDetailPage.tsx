import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import ConfirmDialog from '../components/ConfirmDialog';
import NestedChecklist from '../components/NestedChecklist';
import { IconButton } from '../components/ui';
import { api, fmtDate } from '../lib/api';
import {
  appendPackingChecklistItem,
  isPackingListTitle,
  notesAreChecklist,
  packingChecklistProgress,
  parsePackingChecklist,
  togglePackingChecklistLine,
} from '../lib/packing-checklist';
import type {
  TripHub,
  TripListItemActivity,
  TripListItemActivityType,
  TripListItemRow,
} from '../lib/trip-types';

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="expense-detail-row">
      <span className="expense-detail-label">{label}</span>
      <span className="expense-detail-value">{children}</span>
    </div>
  );
}

function listItemTypeLabel(type: TripListItemRow['type']): string {
  if (type === 'PACK') return 'Llevar';
  if (type === 'BUY') return 'Comprar';
  return 'Hacer';
}

function listItemAssigneeLabel(item: TripListItemRow): string {
  if (item.assignToAll) return 'Todos';
  if (item.assignees.length === 0) return 'Sin asignar';
  return item.assignees.map((m) => m.displayName).join(', ');
}

function activityMessage(activity: TripListItemActivity): string {
  const who = activity.member?.displayName ?? 'Alguien';
  switch (activity.type as TripListItemActivityType) {
    case 'CREATED':
      return `${who} creó la lista`;
    case 'UPDATED':
      return `${who} editó la lista`;
    case 'MARKED_DONE':
      return `${who} marcó como listo`;
    case 'MARKED_PENDING':
      return `${who} marcó como pendiente`;
    case 'CHECKLIST_DONE':
      return activity.detail
        ? `${who} marcó «${activity.detail}» como listo`
        : `${who} marcó un ítem como listo`;
    case 'CHECKLIST_PENDING':
      return activity.detail
        ? `${who} desmarcó «${activity.detail}»`
        : `${who} desmarcó un ítem`;
    case 'CHECKLIST_ADDED':
      return activity.detail
        ? `${who} agregó «${activity.detail}»`
        : `${who} agregó un ítem`;
    default:
      return `${who} actualizó la lista`;
  }
}

function formatActivityWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const now = Date.now();
  const diffMs = now - date.getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return 'Ahora';
  if (mins < 60) return `Hace ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Hace ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `Hace ${days} d`;
  return fmtDate(iso);
}

export default function TripListItemDetailPage() {
  const { id: tripId, itemId } = useParams<{ id: string; itemId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { data: trip } = useQuery({
    queryKey: ['trips', tripId],
    queryFn: () => api<TripHub>(`/trips/${tripId}`),
    enabled: Boolean(tripId),
  });

  const { data: item, isLoading, error } = useQuery({
    queryKey: ['trips', tripId, 'list-items', itemId],
    queryFn: () => api<TripListItemRow>(`/trips/${tripId}/list-items/${itemId}`),
    enabled: Boolean(tripId && itemId),
  });

  const { data: activities, isLoading: activitiesLoading } = useQuery({
    queryKey: ['trips', tripId, 'list-items', itemId, 'activities'],
    queryFn: () =>
      api<TripListItemActivity[]>(`/trips/${tripId}/list-items/${itemId}/activities`),
    enabled: Boolean(tripId && itemId),
  });

  const invalidateItem = () => {
    void queryClient.invalidateQueries({ queryKey: ['trips', tripId, 'list-items'] });
    void queryClient.invalidateQueries({ queryKey: ['trips', tripId, 'list-items', itemId] });
    void queryClient.invalidateQueries({
      queryKey: ['trips', tripId, 'list-items', itemId, 'activities'],
    });
  };

  const toggleMutation = useMutation({
    mutationFn: (status: 'PENDING' | 'DONE') =>
      api(`/trips/${tripId}/list-items/${itemId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      }),
    onSuccess: invalidateItem,
  });

  const checklistToggleMutation = useMutation({
    mutationFn: ({
      notes,
      status,
    }: {
      notes: string;
      status?: 'PENDING' | 'DONE';
    }) =>
      api(`/trips/${tripId}/list-items/${itemId}`, {
        method: 'PATCH',
        body: JSON.stringify({ notes, ...(status ? { status } : {}) }),
      }),
    onMutate: async ({ notes, status }) => {
      await queryClient.cancelQueries({ queryKey: ['trips', tripId, 'list-items', itemId] });
      const previous = queryClient.getQueryData<TripListItemRow>([
        'trips',
        tripId,
        'list-items',
        itemId,
      ]);
      if (previous) {
        queryClient.setQueryData<TripListItemRow>(['trips', tripId, 'list-items', itemId], {
          ...previous,
          notes,
          status: status ?? previous.status,
        });
      }
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(['trips', tripId, 'list-items', itemId], ctx.previous);
      }
    },
    onSettled: invalidateItem,
  });

  const deleteMutation = useMutation({
    mutationFn: () => api(`/trips/${tripId}/list-items/${itemId}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['trips', tripId, 'list-items'] });
      navigate(`/viajes/${tripId}?tab=listas`, { replace: true });
    },
  });

  if (!tripId || !itemId) return <Navigate to="/viajes" replace />;

  if (isLoading && !item) {
    return <div className="page-loading">Cargando…</div>;
  }

  if (error || !item) {
    return (
      <div className="page">
        <header className="page-header">
          <IconButton
            icon="arrow_back"
            label="Volver"
            onClick={() => navigate(`/viajes/${tripId}?tab=listas`)}
          />
          <h1>Lista</h1>
          <span />
        </header>
        <p className="error">No se pudo cargar la lista.</p>
      </div>
    );
  }

  const closed = trip?.status === 'CLOSED';
  const typeLabel = listItemTypeLabel(item.type);
  const assigneeLabel = listItemAssigneeLabel(item);
  const isPackingList = item.type === 'PACK' && isPackingListTitle(item.title);
  const hasNestedChecklist = Boolean(
    item.notes &&
      (notesAreChecklist(item.notes) ||
        (isPackingList && parsePackingChecklist(item.notes).some((e) => e.kind === 'item'))),
  );

  const toggleChecklistLine = (lineIndex: number) => {
    const nextNotes = togglePackingChecklistLine(item.notes, lineIndex);
    const progress = packingChecklistProgress(nextNotes);
    const status =
      progress.total > 0 && progress.done === progress.total
        ? ('DONE' as const)
        : progress.done < progress.total && item.status === 'DONE'
          ? ('PENDING' as const)
          : undefined;
    checklistToggleMutation.mutate({ notes: nextNotes, status });
  };

  const addChecklistItem = (title: string) => {
    const nextNotes = appendPackingChecklistItem(item.notes, title);
    if (nextNotes === (item.notes ?? '')) return;
    const progress = packingChecklistProgress(nextNotes);
    const status =
      item.status === 'DONE' && progress.done < progress.total
        ? ('PENDING' as const)
        : undefined;
    checklistToggleMutation.mutate({ notes: nextNotes, status });
  };

  return (
    <div className="page">
      <header className="page-header">
        <IconButton
          icon="arrow_back"
          label="Volver"
          onClick={() => navigate(`/viajes/${tripId}?tab=listas`)}
        />
        <h1>Lista</h1>
        <span />
      </header>

      <section className="card expense-detail-hero listas-detail-hero">
        <div className="listas-detail-hero-top">
          {!hasNestedChecklist && (
            <input
              type="checkbox"
              className="listas-detail-status"
              checked={item.status === 'DONE'}
              disabled={closed || toggleMutation.isPending}
              aria-label={item.status === 'DONE' ? 'Marcar pendiente' : 'Marcar hecho'}
              onChange={() =>
                toggleMutation.mutate(item.status === 'DONE' ? 'PENDING' : 'DONE')
              }
            />
          )}
          <div>
            <strong
              className={
                item.status === 'DONE' && !hasNestedChecklist
                  ? 'listas-detail-title listas-detail-title-done'
                  : 'listas-detail-title'
              }
            >
              {item.title}
            </strong>
            <small>
              {typeLabel} · {assigneeLabel}
            </small>
          </div>
        </div>
      </section>

      {hasNestedChecklist && item.notes ? (
        <section className="card listas-detail-checklist">
          <h2>Ítems</h2>
          <NestedChecklist
            notes={item.notes}
            closed={Boolean(closed)}
            busy={checklistToggleMutation.isPending}
            onToggleLine={toggleChecklistLine}
            onAddItem={!closed ? addChecklistItem : undefined}
          />
        </section>
      ) : item.notes ? (
        <section className="card">
          <h2>Notas</h2>
          <p className="listas-detail-notes">{item.notes}</p>
        </section>
      ) : null}

      <section className="card">
        <h2>Resumen</h2>
        <DetailRow label="Tipo">{typeLabel}</DetailRow>
        <DetailRow label="Asignado a">{assigneeLabel}</DetailRow>
        <DetailRow label="Estado">{item.status === 'DONE' ? 'Listo' : 'Pendiente'}</DetailRow>
      </section>

      <section className="card">
        <h2>Actividad</h2>
        {activitiesLoading && <p className="hint">Cargando…</p>}
        {!activitiesLoading && (activities?.length ?? 0) === 0 && (
          <p className="hint">Todavía no hay actividad registrada.</p>
        )}
        {(activities?.length ?? 0) > 0 && (
          <ul className="listas-activity-list">
            {activities!.map((activity) => (
              <li key={activity.id} className="listas-activity-item">
                <span className="listas-activity-message">{activityMessage(activity)}</span>
                <time className="listas-activity-when" dateTime={activity.createdAt}>
                  {formatActivityWhen(activity.createdAt)}
                </time>
              </li>
            ))}
          </ul>
        )}
      </section>

      {closed && <p className="hint center">Viaje cerrado — solo lectura</p>}

      {!closed && (
        <div className="confirm-actions expense-detail-actions">
          <button
            type="button"
            className="btn-primary"
            onClick={() => navigate(`/viajes/${tripId}/listas/${itemId}/editar`)}
          >
            Editar
          </button>
          <button
            type="button"
            className="btn-danger"
            disabled={deleteMutation.isPending}
            onClick={() => setConfirmDelete(true)}
          >
            Eliminar
          </button>
        </div>
      )}

      <p className="hint center">
        <Link to={`/viajes/${tripId}?tab=listas`}>Volver a listas</Link>
      </p>

      <ConfirmDialog
        open={confirmDelete}
        title="¿Eliminar esta lista?"
        message={
          <>
            <strong>{item.title}</strong>
            <span className="confirm-warning">Esta acción no se puede deshacer.</span>
          </>
        }
        confirmLabel="Eliminar"
        cancelLabel="Cancelar"
        loading={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate()}
        onCancel={() => !deleteMutation.isPending && setConfirmDelete(false)}
      />
    </div>
  );
}
