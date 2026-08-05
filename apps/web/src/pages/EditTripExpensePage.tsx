import { useQuery } from '@tanstack/react-query';
import { Link, Navigate, useParams } from 'react-router-dom';
import TripExpenseForm, { initialFromTripExpense } from '../components/TripExpenseForm';
import { api } from '../lib/api';
import type { TripExpense, TripHub } from '../lib/trip-types';

export default function EditTripExpensePage() {
  const { id: tripId, expenseId } = useParams<{ id: string; expenseId: string }>();

  const { data: trip, isLoading: tripLoading } = useQuery({
    queryKey: ['trips', tripId],
    queryFn: () => api<TripHub>(`/trips/${tripId}`),
    enabled: Boolean(tripId),
  });

  const { data: expense, isLoading: expenseLoading, error } = useQuery({
    queryKey: ['trips', tripId, 'expenses', expenseId],
    queryFn: () => api<TripExpense>(`/trips/${tripId}/expenses/${expenseId}`),
    enabled: Boolean(tripId && expenseId),
  });

  if (!tripId || !expenseId) return <Navigate to="/viajes" replace />;

  if (!navigator.onLine) {
    return (
      <div className="page">
        <div className="offline-saved">
          <span className="big-emoji">📴</span>
          <h2>Sin conexión</h2>
          <p>Editar gastos requiere conexión a internet.</p>
          <Link to={`/viajes/${tripId}/gastos/${expenseId}`}>← Volver</Link>
        </div>
      </div>
    );
  }

  if (tripLoading || expenseLoading) {
    return <div className="page-loading">Cargando…</div>;
  }

  if (error || !trip || !expense) {
    return (
      <div className="page">
        <p className="error">No se pudo cargar el gasto.</p>
        <Link to={`/viajes/${tripId}`}>← Volver</Link>
      </div>
    );
  }

  if (trip.status === 'CLOSED') {
    return (
      <div className="page">
        <p className="hint">El viaje está cerrado</p>
        <Link to={`/viajes/${tripId}/gastos/${expenseId}`}>← Volver al detalle</Link>
      </div>
    );
  }

  return (
    <TripExpenseForm
      mode="edit"
      trip={trip}
      expenseId={expenseId}
      initial={initialFromTripExpense(expense)}
      title="Editar gasto"
    />
  );
}
