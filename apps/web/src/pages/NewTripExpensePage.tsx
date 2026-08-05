import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import TripExpenseForm from '../components/TripExpenseForm';
import { api } from '../lib/api';
import type { TripHub } from '../lib/trip-types';

export default function NewTripExpensePage() {
  const { id: tripId } = useParams<{ id: string }>();

  const { data: trip, isLoading } = useQuery({
    queryKey: ['trips', tripId],
    queryFn: () => api<TripHub>(`/trips/${tripId}`),
    enabled: Boolean(tripId),
  });

  if (isLoading || !trip) {
    return (
      <div className="page">
        <p className="hint">Cargando…</p>
      </div>
    );
  }

  if (trip.status === 'CLOSED') {
    return (
      <div className="page">
        <p className="hint">El viaje está cerrado</p>
        <Link to={`/viajes/${tripId}`}>← Volver</Link>
      </div>
    );
  }

  return <TripExpenseForm mode="create" trip={trip} title="Nuevo gasto" />;
}
