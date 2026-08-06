import { useMutation, useQuery } from '@tanstack/react-query';
import { FormEvent, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button, IconButton } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { TripInvitePreview } from '../lib/trip-types';

export default function TripJoinPage() {
  const { code } = useParams<{ code: string }>();
  const { user, applyGuestSession, isGuestSession } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'claim' | 'other'>('claim');
  const [claimMemberId, setClaimMemberId] = useState('');
  const [displayName, setDisplayName] = useState(
    user && !user.isGuestSession ? user.name : '',
  );
  const [error, setError] = useState<string | null>(null);

  const preview = useQuery({
    queryKey: ['trips', 'invite', code],
    queryFn: () => api<TripInvitePreview>(`/trips/invite/${code}`),
    enabled: Boolean(code),
  });

  const unclaimed = preview.data?.unclaimedMembers ?? [];

  useEffect(() => {
    if (unclaimed.length === 0) {
      setMode('other');
      return;
    }
    setMode('claim');
    if (!claimMemberId || !unclaimed.some((m) => m.id === claimMemberId)) {
      setClaimMemberId(unclaimed[0]!.id);
    }
  }, [unclaimed, claimMemberId]);

  const mutation = useMutation({
    mutationFn: () =>
      api<{
        tripId: string;
        memberId: string;
        guestToken?: string;
        isGuestSession: boolean;
      }>('/trips/join', {
        method: 'POST',
        body: JSON.stringify({
          code: code?.trim(),
          ...(mode === 'claim' && claimMemberId
            ? { claimMemberId }
            : { displayName: displayName.trim() || undefined }),
        }),
      }),
    onSuccess: (result) => {
      if (result.guestToken) {
        const name =
          mode === 'claim'
            ? (unclaimed.find((m) => m.id === claimMemberId)?.displayName ?? displayName.trim())
            : displayName.trim();
        applyGuestSession(result.guestToken, {
          id: result.memberId,
          name: name || 'Invitado',
          email: '',
          householdId: null,
          isGuestSession: true,
          tripId: result.tripId,
          tripMemberId: result.memberId,
        });
      }
      navigate(`/viajes/${result.tripId}`, { replace: true });
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'No se pudo unir al viaje'),
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (mode === 'claim' && !claimMemberId) {
      setError('Elegí quién sos de la lista');
      return;
    }
    if (mode === 'other' && !displayName.trim()) {
      setError('Ingresá tu nombre');
      return;
    }
    mutation.mutate();
  };

  const backTo = user && !isGuestSession ? '/viajes' : undefined;

  return (
    <div className="page">
      <header className="page-header">
        {backTo ? <IconButton icon="arrow_back" label="Volver" to={backTo} /> : <span />}
        <h1>Unirse al viaje</h1>
        <span />
      </header>

      <form className="card promo-form" onSubmit={onSubmit}>
        <p className="hint">
          Te sumás solo a este viaje — no hace falta crear una cuenta de Biko.
        </p>

        {preview.isLoading && <p className="hint">Cargando invitación…</p>}
        {preview.isError && (
          <p className="error">
            {(preview.error as Error)?.message ?? 'Invitación inválida'}
          </p>
        )}

        {preview.data && (
          <>
            <p>
              <strong>{preview.data.trip.name}</strong>
              {preview.data.trip.destination ? ` · ${preview.data.trip.destination}` : ''}
            </p>

            {unclaimed.length > 0 && (
              <>
                <p className="field-label">¿Quién sos?</p>
                <ul className="list-plain" style={{ marginBottom: 12 }}>
                  {unclaimed.map((m) => (
                    <li key={m.id} className="list-row">
                      <label className="row-between" style={{ width: '100%', cursor: 'pointer' }}>
                        <span>{m.displayName}</span>
                        <input
                          type="radio"
                          name="claim"
                          checked={mode === 'claim' && claimMemberId === m.id}
                          onChange={() => {
                            setMode('claim');
                            setClaimMemberId(m.id);
                          }}
                        />
                      </label>
                    </li>
                  ))}
                  <li className="list-row">
                    <label className="row-between" style={{ width: '100%', cursor: 'pointer' }}>
                      <span>Otro / no estoy en la lista</span>
                      <input
                        type="radio"
                        name="claim"
                        checked={mode === 'other'}
                        onChange={() => setMode('other')}
                      />
                    </label>
                  </li>
                </ul>
              </>
            )}

            {(mode === 'other' || unclaimed.length === 0) && (
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
            )}
          </>
        )}

        {error && <p className="error">{error}</p>}
        <Button
          type="submit"
          variant="filled"
          block
          disabled={mutation.isPending || !code || preview.isLoading || preview.isError}
        >
          {mutation.isPending ? 'Entrando…' : 'Entrar al viaje'}
        </Button>
      </form>
    </div>
  );
}
