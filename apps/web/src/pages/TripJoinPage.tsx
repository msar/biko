import { useMutation } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

export default function TripJoinPage() {
  const { code } = useParams<{ code: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState(user?.name ?? '');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      api<{ tripId: string }>('/trips/join', {
        method: 'POST',
        body: JSON.stringify({
          code: code?.trim(),
          displayName: displayName.trim() || undefined,
        }),
      }),
    onSuccess: (result) => {
      navigate(`/viajes/${result.tripId}`, { replace: true });
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'No se pudo unir al viaje'),
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    mutation.mutate();
  };

  return (
    <div className="page">
      <header className="page-header">
        <Link to="/viajes" className="icon-btn" aria-label="Volver">
          ←
        </Link>
        <h1>Unirse al viaje</h1>
        <span />
      </header>

      <form className="card promo-form" onSubmit={onSubmit}>
        <p className="hint">
          Te sumás solo a este viaje — no entrás al hogar de nadie.
        </p>
        <label>
          Tu nombre en el viaje
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Cómo te ven los demás"
            required
            autoFocus
          />
        </label>
        {code && (
          <p className="hint">
            Código: <code>{code}</code>
          </p>
        )}
        {error && <p className="error">{error}</p>}
        <button type="submit" className="btn-primary" disabled={mutation.isPending || !code}>
          {mutation.isPending ? 'Entrando…' : 'Entrar al viaje'}
        </button>
      </form>
    </div>
  );
}
