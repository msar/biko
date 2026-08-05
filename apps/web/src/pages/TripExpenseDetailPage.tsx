import { TRIP_CATEGORY_LABELS } from '@biko/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import ConfirmDialog from '../components/ConfirmDialog';
import { IconButton } from '../components/ui';
import { api, fmtDate, fmtMoney } from '../lib/api';
import type { TripExpense, TripHub } from '../lib/trip-types';
import {
  TRIP_CATEGORY_COLORS,
  accommodationMapsHref,
  isHttpUrl,
  tripExpenseSplitModeLabel,
} from '../lib/trip-utils';

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="expense-detail-row">
      <span className="expense-detail-label">{label}</span>
      <span className="expense-detail-value">{children}</span>
    </div>
  );
}

export default function TripExpenseDetailPage() {
  const { id: tripId, expenseId } = useParams<{ id: string; expenseId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const online = typeof navigator !== 'undefined' ? navigator.onLine : true;

  const { data: trip } = useQuery({
    queryKey: ['trips', tripId],
    queryFn: () => api<TripHub>(`/trips/${tripId}`),
    enabled: Boolean(tripId),
  });

  const { data: expense, isLoading, error } = useQuery({
    queryKey: ['trips', tripId, 'expenses', expenseId],
    queryFn: () => api<TripExpense>(`/trips/${tripId}/expenses/${expenseId}`),
    enabled: Boolean(tripId && expenseId),
  });

  const deleteMutation = useMutation({
    mutationFn: () => api(`/trips/${tripId}/expenses/${expenseId}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['trips', tripId] });
      void queryClient.invalidateQueries({ queryKey: ['trips', tripId, 'expenses'] });
      void queryClient.invalidateQueries({ queryKey: ['trips'] });
      navigate(`/viajes/${tripId}`, { replace: true });
    },
  });

  if (!tripId || !expenseId) return <Navigate to="/viajes" replace />;

  if (isLoading && !expense) {
    return <div className="page-loading">Cargando…</div>;
  }

  if (error || !expense) {
    return (
      <div className="page">
        <header className="page-header">
          <IconButton icon="arrow_back" label="Volver" onClick={() => navigate(`/viajes/${tripId}`)} />
          <h1>Gasto</h1>
          <span />
        </header>
        <p className="error">No se pudo cargar el gasto.</p>
      </div>
    );
  }

  const closed = trip?.status === 'CLOSED';
  const catColor = TRIP_CATEGORY_COLORS[expense.category] ?? '#888';
  const payments =
    expense.payments.length > 0
      ? expense.payments
      : [
          {
            id: 'legacy',
            tripMemberId: expense.paidByMemberId,
            amount: expense.amount,
            displayName: expense.paidByMember.displayName,
            userId: expense.paidByMember.userId,
          },
        ];

  return (
    <div className="page">
      <header className="page-header">
        <IconButton icon="arrow_back" label="Volver" onClick={() => navigate(`/viajes/${tripId}`)} />
        <h1>Detalle</h1>
        <span />
      </header>

      <section className="card expense-detail-hero">
        <div className="expense-detail-hero-top">
          <div className="expense-cat" style={{ background: catColor }} />
          <div>
            <strong className="expense-detail-store">{TRIP_CATEGORY_LABELS[expense.category]}</strong>
            <small>{fmtDate(expense.date)}</small>
          </div>
        </div>
        <div className="expense-detail-net">
          <span>{fmtMoney(expense.amount)}</span>
        </div>
      </section>

      <section className="card">
        <h2>Resumen</h2>
        {expense.note && <DetailRow label="Nota">{expense.note}</DetailRow>}
        <DetailRow label="Categoría">{TRIP_CATEGORY_LABELS[expense.category]}</DetailRow>
        <DetailRow label="Fecha">{fmtDate(expense.date)}</DetailRow>
        <DetailRow label="Reparto">{tripExpenseSplitModeLabel(expense.splitMode)}</DetailRow>
        <DetailRow label="Quién pagó">
          {payments.length <= 1
            ? (payments[0]?.displayName ?? expense.paidByMember.displayName)
            : payments.map((p) => `${p.displayName} (${fmtMoney(p.amount)})`).join(', ')}
        </DetailRow>
      </section>

      {payments.length > 0 && (
        <section className="card">
          <h2>Pagadores</h2>
          {payments.map((p) => (
            <DetailRow key={p.id} label={p.displayName}>
              {fmtMoney(p.amount)}
            </DetailRow>
          ))}
        </section>
      )}

      {expense.allocations.length > 0 && (
        <section className="card">
          <h2>Partes</h2>
          {expense.allocations.map((a) => (
            <DetailRow key={a.id} label={a.displayName}>
              {fmtMoney(a.amount)}
            </DetailRow>
          ))}
        </section>
      )}

      {expense.accommodation && (
        <section className="card">
          <h2>Alojamiento vinculado</h2>
          <DetailRow label="Nombre">
            {expense.accommodation.label?.trim() || 'Alojamiento del viaje'}
          </DetailRow>
          {expense.accommodation.address && (
            <DetailRow label="Dirección">
              {isHttpUrl(expense.accommodation.address) ? (
                <a
                  href={accommodationMapsHref(expense.accommodation.address)}
                  target="_blank"
                  rel="noreferrer"
                >
                  Ver en mapa
                </a>
              ) : (
                <a
                  href={accommodationMapsHref(expense.accommodation.address)}
                  target="_blank"
                  rel="noreferrer"
                >
                  {expense.accommodation.address}
                </a>
              )}
            </DetailRow>
          )}
          <p className="hint">
            <Link to={`/viajes/${tripId}`}>Ver en el viaje</Link>
          </p>
        </section>
      )}

      {closed && <p className="hint center">Viaje cerrado — solo lectura</p>}

      {!online && !closed && (
        <p className="hint center">Sin conexión: podés ver el gasto, pero editar o eliminar requiere internet.</p>
      )}

      {!closed && (
        <div className="confirm-actions expense-detail-actions">
          <button
            type="button"
            className="btn-primary"
            disabled={!online}
            onClick={() => navigate(`/viajes/${tripId}/gastos/${expenseId}/editar`)}
          >
            Editar
          </button>
          <button
            type="button"
            className="btn-danger"
            disabled={!online || deleteMutation.isPending}
            onClick={() => setConfirmDelete(true)}
          >
            Eliminar
          </button>
        </div>
      )}

      <p className="hint center">
        <Link to={`/viajes/${tripId}`}>Volver al viaje</Link>
      </p>

      <ConfirmDialog
        open={confirmDelete}
        title="¿Eliminar este gasto?"
        message={
          <>
            <strong>{TRIP_CATEGORY_LABELS[expense.category]}</strong>
            <span>
              {fmtDate(expense.date)} · {fmtMoney(expense.amount)}
            </span>
            {expense.accommodation && (
              <span className="confirm-warning">Se desvincula del alojamiento del viaje.</span>
            )}
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
