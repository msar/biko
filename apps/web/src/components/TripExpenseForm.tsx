import { TRIP_CATEGORY_LABELS, TRIP_EXPENSE_CATEGORIES, type TripExpenseCategory } from '@biko/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  applyRemainingToAmount,
  moneyRemaining,
  parseMoneyInput,
  remainingBalance,
  remainingHintLabel,
  roundMoney,
} from '../lib/amount-remaining';
import { api } from '../lib/api';
import type { SplitMode, TripExpense, TripHub, TripMember } from '../lib/trip-types';
import { dateInputValue, todayIso } from '../lib/trip-utils';

type SplitSubMode = 'EQUAL' | 'AMOUNT' | 'SHARES' | 'PERCENTAGE';

type PayerRow = { key: string; memberId: string; amount: string };

export type TripExpenseFormInitial = {
  amount: string;
  category: TripExpenseCategory;
  payers: PayerRow[];
  note: string;
  date: string;
  splitSubMode: SplitSubMode;
  assignMode: 'all' | 'one';
  assignToMemberId: string;
  splitValues: Record<string, string>;
  linkedAccommodation: boolean;
};

function newPayerKey() {
  return `p-${Math.random().toString(36).slice(2, 9)}`;
}

export function initialFromTripExpense(expense: TripExpense): TripExpenseFormInitial {
  const payments =
    expense.payments.length > 0
      ? expense.payments
      : [
          {
            tripMemberId: expense.paidByMemberId,
            amount: expense.amount,
            displayName: expense.paidByMember.displayName,
          },
        ];

  const payers: PayerRow[] = payments.map((p) => ({
    key: newPayerKey(),
    memberId: p.tripMemberId,
    amount: String(p.amount),
  }));

  const mode: SplitMode = expense.splitMode;
  let assignMode: 'all' | 'one' = 'all';
  let splitSubMode: SplitSubMode = 'EQUAL';
  let assignToMemberId = '';
  const splitValues: Record<string, string> = {};

  if (mode === 'ASSIGN') {
    assignMode = 'one';
    const full = expense.allocations.find((a) => a.amount >= expense.amount - 0.02);
    assignToMemberId = full?.tripMemberId ?? expense.allocations[0]?.tripMemberId ?? '';
  } else if (mode === 'EQUAL') {
    splitSubMode = 'EQUAL';
  } else {
    splitSubMode = mode;
    for (const a of expense.allocations) {
      if (mode === 'AMOUNT') {
        splitValues[a.tripMemberId] = String(a.amount);
      } else if (mode === 'PERCENTAGE') {
        const pct = expense.amount > 0 ? Math.round((a.amount / expense.amount) * 1000) / 10 : 0;
        splitValues[a.tripMemberId] = String(pct);
      } else {
        // SHARES: recover relative weights from amounts (best effort)
        splitValues[a.tripMemberId] = String(Math.max(1, Math.round(a.amount * 100) / 100));
      }
    }
  }

  return {
    amount: String(expense.amount),
    category: expense.category,
    payers,
    note: expense.note ?? '',
    date: dateInputValue(expense.date) || todayIso(),
    splitSubMode,
    assignMode,
    assignToMemberId,
    splitValues,
    linkedAccommodation: Boolean(expense.accommodation),
  };
}

interface TripExpenseFormProps {
  mode: 'create' | 'edit';
  trip: TripHub;
  expenseId?: string;
  initial?: Partial<TripExpenseFormInitial>;
  title: string;
}

export default function TripExpenseForm({ mode, trip, expenseId, initial, title }: TripExpenseFormProps) {
  const tripId = trip.id;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const members: TripMember[] = trip.members;

  const [amount, setAmount] = useState(initial?.amount ?? '');
  const [category, setCategory] = useState<TripExpenseCategory>(initial?.category ?? 'COMIDA');
  const [payers, setPayers] = useState<PayerRow[]>(initial?.payers ?? []);
  const [note, setNote] = useState(initial?.note ?? '');
  const [date, setDate] = useState(initial?.date ?? todayIso());
  const [splitSubMode, setSplitSubMode] = useState<SplitSubMode>(initial?.splitSubMode ?? 'EQUAL');
  const [assignMode, setAssignMode] = useState<'all' | 'one'>(initial?.assignMode ?? 'all');
  const [assignToMemberId, setAssignToMemberId] = useState(initial?.assignToMemberId ?? '');
  const [splitValues, setSplitValues] = useState<Record<string, string>>(initial?.splitValues ?? {});
  const [error, setError] = useState<string | null>(null);
  const linkedAccommodation = Boolean(initial?.linkedAccommodation);

  useEffect(() => {
    if (mode !== 'create' || payers.length > 0) return;
    const defaultId = trip.myMember.id || trip.members[0]?.id;
    if (defaultId) {
      setPayers([{ key: newPayerKey(), memberId: defaultId, amount: '' }]);
    }
  }, [mode, trip, payers.length]);

  const mutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => {
      if (mode === 'edit' && expenseId) {
        return api(`/trips/${tripId}/expenses/${expenseId}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        });
      }
      return api(`/trips/${tripId}/expenses`, { method: 'POST', body: JSON.stringify(body) });
    },
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: ['trips', tripId] });
      void queryClient.invalidateQueries({ queryKey: ['trips', tripId, 'expenses'] });
      void queryClient.invalidateQueries({ queryKey: ['trips'] });
      const id = (saved as { id?: string } | undefined)?.id ?? expenseId;
      if (id) {
        void queryClient.invalidateQueries({ queryKey: ['trips', tripId, 'expenses', id] });
        navigate(`/viajes/${tripId}/gastos/${id}`, { replace: true });
      } else {
        navigate(`/viajes/${tripId}`, { replace: true });
      }
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'No se pudo guardar'),
  });

  const amountNum = useMemo(() => parseMoneyInput(amount), [amount]);

  const parsedPayments = useMemo(() => {
    return payers
      .map((p) => ({
        memberId: p.memberId,
        amount: parseMoneyInput(p.amount),
      }))
      .filter((p) => p.memberId && Number.isFinite(p.amount) && p.amount > 0);
  }, [payers]);

  const paymentsSum = useMemo(
    () => roundMoney(parsedPayments.reduce((s, p) => s + p.amount, 0)),
    [parsedPayments],
  );

  const paymentsRemaining = moneyRemaining(
    amountNum,
    payers.map((p) => parseMoneyInput(p.amount)),
  );
  const canAssignPaymentResto = remainingBalance(paymentsRemaining) === 'short';

  const splitAmountParts = useMemo(
    () => members.map((m) => parseMoneyInput(splitValues[m.id] ?? '')),
    [members, splitValues],
  );
  const splitAmountsRemaining = moneyRemaining(amountNum, splitAmountParts);
  const canAssignSplitResto =
    assignMode === 'all' && splitSubMode === 'AMOUNT' && remainingBalance(splitAmountsRemaining) === 'short';

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

    if (assignMode === 'all' && splitSubMode === 'AMOUNT') {
      if (remainingBalance(splitAmountsRemaining) !== 'ok') {
        setError('La suma de los montos del reparto debe coincidir con el total del gasto');
        return;
      }
    }

    if (assignMode === 'all' && splitSubMode === 'SHARES') {
      const values = members.map((m) => Number(String(splitValues[m.id] ?? '').replace(',', '.')));
      if (values.some((v) => !Number.isFinite(v) || v < 0)) {
        setError('Completá las partes de cada viajero (números ≥ 0)');
        return;
      }
      if (values.reduce((s, v) => s + v, 0) <= 0) {
        setError('La suma de partes debe ser mayor a 0');
        return;
      }
    }

    if (assignMode === 'all' && splitSubMode === 'PERCENTAGE') {
      const values = members.map((m) => Number(String(splitValues[m.id] ?? '').replace(',', '.')));
      if (values.some((v) => !Number.isFinite(v) || v < 0)) {
        setError('Completá el % de cada viajero (números ≥ 0)');
        return;
      }
      const sum = values.reduce((s, v) => s + v, 0);
      if (Math.abs(sum - 100) > 0.05) {
        setError('La suma de porcentajes debe ser 100');
        return;
      }
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
        value: Number(String(splitValues[m.id] ?? '0').replace(',', '.')),
      }));
    }

    mutation.mutate(body);
  };

  const updatePayer = (key: string, patch: Partial<PayerRow>) => {
    setPayers((prev) => prev.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  };

  const setAmountAndSync = (raw: string) => {
    setAmount(raw);
    const n = parseMoneyInput(raw);
    if (!(n > 0)) return;
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

  const assignPaymentResto = (key: string) => {
    if (!canAssignPaymentResto) return;
    setPayers((prev) =>
      prev.map((p) =>
        p.key === key ? { ...p, amount: applyRemainingToAmount(p.amount, paymentsRemaining) } : p,
      ),
    );
  };

  const assignSplitResto = (memberId: string) => {
    if (!canAssignSplitResto) return;
    setSplitValues((prev) => ({
      ...prev,
      [memberId]: applyRemainingToAmount(prev[memberId] ?? '', splitAmountsRemaining),
    }));
  };

  const backTo =
    mode === 'edit' && expenseId
      ? `/viajes/${tripId}/gastos/${expenseId}`
      : `/viajes/${tripId}`;

  return (
    <div className="page">
      <header className="page-header">
        <Link to={backTo} className="icon-btn" aria-label="Volver">
          ←
        </Link>
        <h1>{title}</h1>
        <span />
      </header>

      {linkedAccommodation && (
        <p className="hint">
          Este gasto está vinculado al alojamiento. Si cambiás la categoría, se desvincula; si
          mantenés Alojamiento, el monto del alojamiento se actualiza.
        </p>
      )}

      <form className="card promo-form" onSubmit={onSubmit}>
        <label>
          Monto
          <input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmountAndSync(e.target.value)}
            placeholder="0"
            required
            autoFocus={mode === 'create'}
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
              {canAssignPaymentResto && (
                <button
                  type="button"
                  className="btn-link amount-resto-btn"
                  onClick={() => assignPaymentResto(row.key)}
                >
                  Usar resto
                </button>
              )}
            </label>
          </div>
        ))}
        {members.length > payers.length && (
          <button type="button" className="btn-secondary" onClick={addPayer}>
            + Agregar pagador
          </button>
        )}
        {amountNum > 0 &&
          payers.length > 0 &&
          (payers.length > 1 || remainingBalance(paymentsRemaining) !== 'ok') && (
          <p className={`hint ${remainingBalance(paymentsRemaining) !== 'ok' ? 'error' : ''}`}>
            {remainingHintLabel(paymentsRemaining)}
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
              ).map(([m, label]) => (
                <button
                  key={m}
                  type="button"
                  className={splitSubMode === m ? 'active' : ''}
                  onClick={() => setSplitSubMode(m)}
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
                  {splitSubMode === 'AMOUNT' && canAssignSplitResto && (
                    <button
                      type="button"
                      className="btn-link amount-resto-btn"
                      onClick={() => assignSplitResto(m.id)}
                    >
                      Usar resto
                    </button>
                  )}
                </label>
              ))}
            {splitSubMode === 'AMOUNT' && amountNum > 0 && (
              <p className={`hint ${remainingBalance(splitAmountsRemaining) !== 'ok' ? 'error' : ''}`}>
                {remainingHintLabel(splitAmountsRemaining)}
              </p>
            )}
          </>
        )}

        {error && <p className="error">{error}</p>}
        <button type="submit" className="btn-primary" disabled={mutation.isPending}>
          {mutation.isPending ? 'Guardando…' : mode === 'edit' ? 'Guardar cambios' : 'Guardar gasto'}
        </button>
      </form>
    </div>
  );
}
