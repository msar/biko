import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { Button, Icon, IconButton } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { TripListItem } from '../lib/trip-types';
import { TRIP_STATUS_LABEL } from '../lib/trip-utils';

function fmtRange(start: string | null, end: string | null): string | null {
  if (!start && !end) return null;
  const fmt = (iso: string) =>
    new Date(iso).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
  if (start && end) return `${fmt(start)} – ${fmt(end)}`;
  if (start) return `Desde ${fmt(start)}`;
  return `Hasta ${fmt(end!)}`;
}

export default function TripsPage() {
  const navigate = useNavigate();
  const { isGuestSession, user } = useAuth();
  const { data: trips, isLoading, error } = useQuery({
    queryKey: ['trips'],
    queryFn: () => api<TripListItem[]>('/trips'),
    enabled: !isGuestSession,
  });

  if (isGuestSession && user?.tripId) {
    return <Navigate to={`/viajes/${user.tripId}`} replace />;
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Viajes</h1>
          <p className="hint">Gestor de viajes — gastos, listas y liquidación del grupo.</p>
        </div>
        <Button to="/viajes/nuevo" variant="filled" size="sm">
          Nuevo
        </Button>
      </header>

      {isLoading && <p className="hint">Cargando…</p>}
      {error && <p className="error">No se pudieron cargar los viajes</p>}

      {!isLoading && trips && trips.length === 0 && (
        <div className="empty-state md-empty">
          <Icon name="luggage" />
          <p>Todavía no hay viajes. Creá el primero e invitá al grupo.</p>
          <Button to="/viajes/nuevo" variant="filled">
            Crear viaje
          </Button>
        </div>
      )}

      <div className="trip-list">
        {trips?.map((trip) => {
          const range = fmtRange(trip.startDate, trip.endDate);
          return (
            <button
              key={trip.id}
              type="button"
              className="card trip-list-card"
              onClick={() => navigate(`/viajes/${trip.id}`)}
            >
              <div className="row-between">
                <strong>{trip.name}</strong>
                <span className={`trip-status trip-status-${trip.status.toLowerCase()}`}>
                  {TRIP_STATUS_LABEL[trip.status] ?? trip.status}
                </span>
              </div>
              {trip.destination && <p className="hint">{trip.destination}</p>}
              {range && <p className="hint">{range}</p>}
              <p className="hint">
                {trip.memberCount} {trip.memberCount === 1 ? 'persona' : 'personas'}
                {' · '}
                {trip.expenseCount} {trip.expenseCount === 1 ? 'gasto' : 'gastos'}
              </p>
            </button>
          );
        })}
      </div>

      {user?.householdId && (
        <p className="hint">
          <Link to="/">← Volver a Biko</Link>
        </p>
      )}
    </div>
  );
}

export function NewTripPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [destination, setDestination] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api<{ id: string }>('/trips', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: (trip) => {
      void queryClient.invalidateQueries({ queryKey: ['trips'] });
      navigate(`/viajes/${trip.id}`, { replace: true });
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'No se pudo crear el viaje'),
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    mutation.mutate({
      name: name.trim(),
      destination: destination.trim() || null,
      startDate: startDate || null,
      endDate: endDate || null,
    });
  };

  return (
    <div className="page">
      <header className="page-header">
        <IconButton icon="arrow_back" label="Volver" to="/viajes" />
        <h1>Nuevo viaje</h1>
        <span />
      </header>

      <form className="card promo-form" onSubmit={onSubmit}>
        <label>
          Nombre
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Fin de semana en Córdoba"
            required
            autoFocus
          />
        </label>
        <label>
          Destino
          <input
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            placeholder="Opcional"
          />
        </label>
        <div className="form-row-2">
          <label>
            Desde
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </label>
          <label>
            Hasta
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </label>
        </div>
        {error && <p className="error">{error}</p>}
        <Button type="submit" variant="filled" block disabled={mutation.isPending || !name.trim()}>
          {mutation.isPending ? 'Creando…' : 'Crear viaje'}
        </Button>
      </form>
    </div>
  );
}
