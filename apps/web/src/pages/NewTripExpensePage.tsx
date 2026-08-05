import { TRIP_CATEGORY_LABELS, TRIP_EXPENSE_CATEGORIES, type TripExpenseCategory } from '@biko/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import type { TripHub } from '../lib/trip-types';
import { todayIso } from '../lib/trip-utils';

type SplitSubMode = 'EQUAL' | 'AMOUNT' | 'SHARES' | 'PERCENTAGE';

type PayerRow = { key: string; memberId: string; amount: string };

function newPayerKey() {
  return `p-${Math.random().toString(36).slice(2, 9)}`;
}

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
  const [payers, setPayers] = useState<PayerRow[]>([]);
  const [note, setNote] = useState('');
  const [date, setDate] = useState(todayIso());
  const [splitSubMode, setSplitSubMode] = useState<SplitSubMode>('EQUAL');
  const [assignMode, setAssignMode] = useState<'all' | 'one'>('all');
  const [assignToMemberId, setAssignToMemberId] = useState('');
  const [splitValues, setSplitValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!trip || payers.length > 0) return;
    const defaultId = trip.myMember.id || trip.members[0]?.id;
    if (defaultId) {
      setPayers([{ key: newPayerKey(), memberId: defaultId, amount: '' }]);
    }
  }, [trip, payers.length]);

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

  const parsedPayments = useMemo(() => {
    return payers
      .map((p) => ({
        memberId: p.memberId,
        amount: Number(String(p.amount).replace(',', '.')),
      }))
      .filter((p) => p.memberId && Number.isFinite(p.amount) && p.amount > 0);
  }, [payers]);

  const paymentsSum = useMemo(
    () => Math.round(parsedPayments.reduce((s, p) => s + p.amount, 0) * 100) / 100,
    [parsedPayments],
  );

  const paymentsRemaining = Math.round((amountNum - paymentsSum) * 100) / 100;

  const usedMemberIds = useMemo(() => new Set(payers.map((p) => p.memberId)), [payers]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!(amountNum > 0)) {
      setError('Completá el monto');
      return;
    }
    if (parsedPayments.length === 0) {
      setError('Agregá al menos un pagador con monto');
      return;
    }
    if (Math.abs(paymentsSum - amountNum) > 0.01) {
      setError('La suma de lo pagado debe coincidir con el monto del gasto');
      return;
    }
    const unique = new Set(parsedPayments.map((p) => p.memberId));
    if (unique.size !== parsedPayments.length) {
      setError('Cada viajero puede aparecer una sola vez entre los pagadores');
      return;
    }

    const body: Record<string, unknown> = {
      amount: amountNum,
      category,
      payments: parsedPayments,
      paidByMemberId: parsedPayments[0]!.memberId,
      note: note.trim() || null,
      date,
    };

    if (assignMode === 'one') {
      body.splitMode = 'ASSIGN';
      body.assignToMemberId = assignToMemberId || parsedPayments[0]!.memberId;
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

  const updatePayer = (key: string, patch: Partial<PayerRow>) => {
    setPayers((prev) => prev.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  };

  const setAmountAndSync = (raw: string) => {
    setAmount(raw);
    const n = Number(raw.replace(',', '.'));
    if (!Number.isFinite(n) || n <= 0) return;
    setPayers((prev) => {
      if (prev.length !== 1) return prev;
      return [{ ...prev[0]!, amount: String(n) }];
    });
  };

  const addPayer = () => {
    const next = members.find((m) => !usedMemberIds.has(m.id));
    if (!next) return;
    const fill =
      paymentsRemaining > 0
        ? String(paymentsRemaining)
        : amountNum > 0 && payers.length === 0
          ? String(amountNum)
          : '';
    setPayers((prev) => [...prev, { key: newPayerKey(), memberId: next.id, amount: fill }]);
  };

  const removePayer = (key: string) => {
    setPayers((prev) => (prev.length <= 1 ? prev : prev.filter((p) => p.key !== key)));
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
            onChange={(e) => setAmountAndSync(e.target.value)}
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

        <p className="field-label">Quién pagó</p>
        <p className="hint">Podés repartir el pago entre varias personas. La suma debe ser el monto total.</p>
        {payers.map((row) => (
          <div key={row.key} className="form-row-2 trip-payer-row">
            <label>
              Viajero
              <select
                value={row.memberId}
                onChange={(e) => updatePayer(row.key, { memberId: e.target.value })}
              >
                {members.map((m) => (
                  <option
                    key={m.id}
                    value={m.id}
                    disabled={usedMemberIds.has(m.id) && m.id !== row.memberId}
                  >
                    {m.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Monto pagado
              <div className="trip-payer-amount-wrap">
                <input
                  inputMode="decimal"
                  value={row.amount}
                  onChange={(e) => updatePayer(row.key, { amount: e.target.value })}
                  placeholder="0"
                  required
                />
                {payers.length > 1 && (
                  <button
                    type="button"
                    className="btn-link"
                    onClick={() => removePayer(row.key)}
                    aria-label="Quitar pagador"
                  >
                    Quitar
                  </button>
                )}
              </div>
            </label>
          </div>
        ))}
        {members.length > payers.length && (
          <button type="button" className="btn-secondary" onClick={addPayer}>
            + Agregar pagador
          </button>
        )}
        {amountNum > 0 && payers.length > 1 && (
          <p className={`hint ${Math.abs(paymentsRemaining) > 0.01 ? 'error' : ''}`}>
            {Math.abs(paymentsRemaining) <= 0.01
              ? 'Suma de pagos OK'
              : paymentsRemaining > 0
                ? `Faltan ${paymentsRemaining.toFixed(2)}`
                : `Sobran ${Math.abs(paymentsRemaining).toFixed(2)}`}
          </p>
        )}

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
              value={assignToMemberId || payers[0]?.memberId || ''}
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
