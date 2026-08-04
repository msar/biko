import { TRIP_CATEGORY_LABELS, TRIP_EXPENSE_CATEGORIES, type TripExpenseCategory } from '@biko/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import type { TripHub } from '../lib/trip-types';
import { todayIso } from '../lib/trip-utils';

type SplitSubMode = 'EQUAL' | 'AMOUNT' | 'SHARES' | 'PERCENTAGE';

export default function NewTripExpensePage() {
  const { id: tripId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: trip, isLoading } = useQuery({
    queryKey: ['trips', tripId],
    queryFn: () => api<TripHub>(`/trips/${tripId}`),
    enabled: Boolean(tripId),
  });

  const members = trip?.members ?? [];
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<TripExpenseCategory>('COMIDA');
  const [paidByMemberId, setPaidByMemberId] = useState('');
  const [note, setNote] = useState('');
  const [date, setDate] = useState(todayIso());
  const [splitSubMode, setSplitSubMode] = useState<SplitSubMode>('EQUAL');
  const [assignMode, setAssignMode] = useState<'all' | 'one'>('all');
  const [assignToMemberId, setAssignToMemberId] = useState('');
  const [splitValues, setSplitValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const defaultPayer = paidByMemberId || trip?.myMember.id || members[0]?.id || '';

  const mutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api(`/trips/${tripId}/expenses`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['trips', tripId] });
      void queryClient.invalidateQueries({ queryKey: ['trips', tripId, 'expenses'] });
      void queryClient.invalidateQueries({ queryKey: ['trips'] });
      navigate(`/viajes/${tripId}`, { replace: true });
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'No se pudo guardar'),
  });

  const amountNum = useMemo(() => {
    const n = Number(amount.replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
  }, [amount]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!(amountNum > 0) || !defaultPayer) {
      setError('Completá monto y pagador');
      return;
    }

    const body: Record<string, unknown> = {
      amount: amountNum,
      category,
      paidByMemberId: defaultPayer,
      note: note.trim() || null,
      date,
    };

    if (assignMode === 'one') {
      body.splitMode = 'ASSIGN';
      body.assignToMemberId = assignToMemberId || defaultPayer;
    } else if (splitSubMode === 'EQUAL') {
      body.splitMode = 'EQUAL';
    } else {
      body.splitMode = splitSubMode;
      body.splitValues = members.map((m) => ({
        memberId: m.id,
        value: Number(splitValues[m.id] || '0'),
      }));
    }

    mutation.mutate(body);
  };

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

  return (
    <div className="page">
      <header className="page-header">
        <Link to={`/viajes/${tripId}`} className="icon-btn" aria-label="Volver">
          ←
        </Link>
        <h1>Nuevo gasto</h1>
        <span />
      </header>

      <form className="card promo-form" onSubmit={onSubmit}>
        <label>
          Monto
          <input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
            required
            autoFocus
          />
        </label>

        <label>
          Categoría
          <select value={category} onChange={(e) => setCategory(e.target.value as TripExpenseCategory)}>
            {TRIP_EXPENSE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {TRIP_CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </label>

        <label>
          Pagó
          <select
            value={defaultPayer}
            onChange={(e) => setPaidByMemberId(e.target.value)}
          >
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.displayName}
              </option>
            ))}
          </select>
        </label>

        <label>
          Fecha
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </label>

        <label>
          Nota
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Opcional" />
        </label>

        <p className="field-label">Reparto</p>
        <div className="segmented">
          <button
            type="button"
            className={assignMode === 'all' ? 'active' : ''}
            onClick={() => setAssignMode('all')}
          >
            Entre todos
          </button>
          <button
            type="button"
            className={assignMode === 'one' ? 'active' : ''}
            onClick={() => setAssignMode('one')}
          >
            A uno
          </button>
        </div>

        {assignMode === 'one' ? (
          <label>
            Asignar a
            <select
              value={assignToMemberId || defaultPayer}
              onChange={(e) => setAssignToMemberId(e.target.value)}
            >
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <>
            <div className="segmented">
              {(
                [
                  ['EQUAL', 'Igual'],
                  ['AMOUNT', '$'],
                  ['SHARES', 'Partes'],
                  ['PERCENTAGE', '%'],
                ] as const
              ).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  className={splitSubMode === mode ? 'active' : ''}
                  onClick={() => setSplitSubMode(mode)}
                >
                  {label}
                </button>
              ))}
            </div>
            {splitSubMode !== 'EQUAL' &&
              members.map((m) => (
                <label key={m.id}>
                  {m.displayName}
                  <input
                    inputMode="decimal"
                    value={splitValues[m.id] ?? ''}
                    onChange={(e) =>
                      setSplitValues((prev) => ({ ...prev, [m.id]: e.target.value }))
                    }
                    placeholder={
                      splitSubMode === 'PERCENTAGE'
                        ? '%'
                        : splitSubMode === 'SHARES'
                          ? 'partes'
                          : '$'
                    }
                  />
                </label>
              ))}
          </>
        )}

        {error && <p className="error">{error}</p>}
        <button type="submit" className="btn-primary" disabled={mutation.isPending}>
          {mutation.isPending ? 'Guardando…' : 'Guardar gasto'}
        </button>
      </form>
    </div>
  );
}
