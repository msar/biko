import { useQuery } from '@tanstack/react-query';
import { Link, Navigate, useParams } from 'react-router-dom';
import TripListItemForm, { initialFromTripListItem } from '../components/TripListItemForm';
import { api } from '../lib/api';
import type { TripHub, TripListItemRow } from '../lib/trip-types';

export default function EditTripListItemPage() {
  const { id: tripId, itemId } = useParams<{ id: string; itemId: string }>();

  const { data: trip, isLoading: tripLoading } = useQuery({
    queryKey: ['trips', tripId],
    queryFn: () => api<TripHub>(`/trips/${tripId}`),
    enabled: Boolean(tripId),
  });

  const { data: item, isLoading: itemLoading, error } = useQuery({
    queryKey: ['trips', tripId, 'list-items', itemId],
    queryFn: () => api<TripListItemRow>(`/trips/${tripId}/list-items/${itemId}`),
    enabled: Boolean(tripId && itemId),
  });

  if (!tripId || !itemId) return <Navigate to="/viajes" replace />;

  if (tripLoading || itemLoading) {
    return <div className="page-loading">Cargando…</div>;
  }

  if (error || !trip || !item) {
    return (
      <div className="page">
        <p className="error">No se pudo cargar la lista.</p>
        <Link to={`/viajes/${tripId}?tab=listas`}>← Volver</Link>
      </div>
    );
  }

  if (trip.status === 'CLOSED') {
    return (
      <div className="page">
        <p className="hint">El viaje está cerrado</p>
        <Link to={`/viajes/${tripId}/listas/${itemId}`}>← Volver al detalle</Link>
      </div>
    );
  }

  return (
    <TripListItemForm
      mode="edit"
      trip={trip}
      itemId={itemId}
      initial={initialFromTripListItem(item)}
      title="Editar lista"
      backTo={`/viajes/${trip.id}/listas/${itemId}`}
    />
  );
}
