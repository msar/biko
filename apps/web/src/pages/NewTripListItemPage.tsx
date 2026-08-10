import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import TripListItemForm from '../components/TripListItemForm';
import { api } from '../lib/api';
import type { TripHub, TripListItemRow } from '../lib/trip-types';

export default function NewTripListItemPage() {
  const { id: tripId } = useParams<{ id: string }>();

  const { data: trip, isLoading } = useQuery({
    queryKey: ['trips', tripId],
    queryFn: () => api<TripHub>(`/trips/${tripId}`),
    enabled: Boolean(tripId),
  });

  const { data: items } = useQuery({
    queryKey: ['trips', tripId, 'list-items'],
    queryFn: () => api<TripListItemRow[]>(`/trips/${tripId}/list-items`),
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
        <Link to={`/viajes/${tripId}?tab=listas`}>← Volver</Link>
      </div>
    );
  }

  return (
    <TripListItemForm
      mode="create"
      trip={trip}
      existingItems={items ?? []}
      title="Nueva lista"
      backTo={`/viajes/${trip.id}?tab=listas`}
    />
  );
}
