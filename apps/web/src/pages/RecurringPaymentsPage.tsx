import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, fmtARS, fmtDate } from '../lib/api';
import type {
  Category,
  ExpenseScope,
  PaymentMethod,
  RecurringAmountType,
  RecurringOccurrence,
  RecurringPayment,
} from '../lib/types';
import { groupMethodsByEntity, paymentMethodDisplayName } from '../lib/payment-method-catalog';

export default function RecurringPaymentsPage() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [completeId, setCompleteId] = useState<string | null>(null);
  const [completeAmount, setCompleteAmount] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data: items } = useQuery({
    queryKey: ['recurring-payments'],
    queryFn: () => api<RecurringPayment[]>('/recurring-payments'),
  });
  const { data: occurrences } = useQuery({
    queryKey: ['recurring-occurrences', 'PENDING'],
    queryFn: () => api<RecurringOccurrence[]>('/recurring-payments/occurrences?status=PENDING'),
  });
  const { data: categories } = useQuery({
    queryKey: ['categories'],
    queryFn: () => api<Category[]>('/categories'),
  });
  const { data: methods } = useQuery({
    queryKey: ['payment-methods'],
    queryFn: () => api<PaymentMethod[]>('/payment-methods'),
  });

  const editing = items?.find((i) => i.id === editId) ?? null;

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['recurring-payments'] });
    void queryClient.invalidateQueries({ queryKey: ['recurring-occurrences'] });
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    void queryClient.invalidateQueries({ queryKey: ['expenses'] });
    void queryClient.invalidateQueries({ queryKey: ['notifications'] });
  };

  const completeMutation = useMutation({
    mutationFn: ({ id, amount }: { id: string; amount: number }) =>
      api(`/recurring-payments/occurrences/${id}/complete`, {
        method: 'POST',
        body: JSON.stringify({ amount }),
      }),
    onSuccess: () => {
      setCompleteId(null);
      setCompleteAmount('');
      invalidate();
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Error'),
  });

  const skipMutation = useMutation({
    mutationFn: (id: string) =>
      api(`/recurring-payments/occurrences/${id}/skip`, { method: 'POST', body: '{}' }),
    onSuccess: invalidate,
    onError: (err) => setError(err instanceof Error ? err.message : 'Error'),
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => api(`/recurring-payments/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Recurrentes</h1>
          <p className="hint">Gas, luz, gym y otros vencimientos fijos o variables.</p>
        </div>
        <button
          type="button"
          className="icon-btn"
          onClick={() => {
            setEditId(null);
            setShowForm((v) => !v);
          }}
          aria-label="Agregar"
        >
          {showForm && !editId ? '✕' : '＋'}
        </button>
      </header>

      {error && <p className="error">{error}</p>}

      {occurrences && occurrences.length > 0 && (
        <section className="card">
          <h2>Vencimientos pendientes</h2>
          {occurrences.map((occ) => (
            <div key={occ.id} className="list-row recurring-occ-row">
              <div>
                <strong>{occ.recurringPayment.name}</strong>
                <small>
                  {fmtDate(occ.dueDate)}
                  {occ.recurringPayment.amountType === 'FIXED' && occ.amount
                    ? ` · ${fmtARS.format(Number(occ.amount))}`
                    : ' · monto variable'}
                </small>
              </div>
              <div className="list-row-actions">
                {occ.recurringPayment.amountType === 'VARIABLE' && (
                  <button
                    type="button"
                    className="btn-link"
                    onClick={() => {
                      setCompleteId(occ.id);
                      setCompleteAmount('');
                      setError(null);
                    }}
                  >
                    Completar
                  </button>
                )}
                <button type="button" className="btn-link" onClick={() => skipMutation.mutate(occ.id)}>
                  Saltear
                </button>
              </div>
            </div>
          ))}
        </section>
      )}

      {completeId && (
        <form
          className="card promo-form"
          onSubmit={(e) => {
            e.preventDefault();
            const amount = Number(completeAmount);
            if (!(amount > 0)) {
              setError('Ingresá un monto válido');
              return;
            }
            completeMutation.mutate({ id: completeId, amount });
          }}
        >
          <h2>Completar monto</h2>
          <label>
            Monto $
            <input
              type="number"
              inputMode="decimal"
              value={completeAmount}
              onChange={(e) => setCompleteAmount(e.target.value)}
              autoFocus
              required
            />
          </label>
          <div className="confirm-actions">
            <button type="button" className="btn-secondary" onClick={() => setCompleteId(null)}>
              Cancelar
            </button>
            <button type="submit" className="btn-primary" disabled={completeMutation.isPending}>
              Guardar gasto
            </button>
          </div>
        </form>
      )}

      {(showForm || editing) && categories && methods && (
        <RecurringForm
          categories={categories}
          methods={methods}
          initial={editing}
          onDone={() => {
            setShowForm(false);
            setEditId(null);
            invalidate();
          }}
          onCancel={() => {
            setShowForm(false);
            setEditId(null);
          }}
        />
      )}

      <section className="card">
        <h2>Tus recurrentes</h2>
        {items?.filter((i) => i.active).map((item) => (
          <div key={item.id} className="list-row">
            <div>
              <strong>
                {item.category.icon} {item.name}
              </strong>
              <small>
                Día {item.dueDay}
                {item.amountType === 'FIXED' && item.amount
                  ? ` · ${fmtARS.format(Number(item.amount))} fijo`
                  : ' · variable'}
                {item.scope === 'PERSONAL' ? ' · Personal' : ' · Hogar'}
                {' · próximo '}
                {fmtDate(item.nextDueDate)}
              </small>
            </div>
            <div className="list-row-actions">
              <button
                type="button"
                className="btn-link"
                onClick={() => {
                  setEditId(item.id);
                  setShowForm(true);
                }}
              >
                Editar
              </button>
              <button type="button" className="btn-link" onClick={() => deactivateMutation.mutate(item.id)}>
                Desactivar
              </button>
            </div>
          </div>
        ))}
        {items && items.filter((i) => i.active).length === 0 && (
          <p className="hint">Todavía no hay pagos recurrentes. Agregá luz, gas, gym…</p>
        )}
      </section>

      <p className="hint center">
        <Link to="/">← Volver al resumen</Link>
      </p>
    </div>
  );
}

function RecurringForm({
  categories,
  methods,
  initial,
  onDone,
  onCancel,
}: {
  categories: Category[];
  methods: PaymentMethod[];
  initial: RecurringPayment | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? categories[0]?.id ?? '');
  const [paymentMethodId, setPaymentMethodId] = useState(initial?.paymentMethodId ?? '');
  const [scope, setScope] = useState<ExpenseScope>(initial?.scope ?? 'HOUSEHOLD');
  const [dueDay, setDueDay] = useState(String(initial?.dueDay ?? 10));
  const [amountType, setAmountType] = useState<RecurringAmountType>(initial?.amountType ?? 'FIXED');
  const [amount, setAmount] = useState(initial?.amount ? String(Number(initial.amount)) : '');
  const [reminderDaysBefore, setReminderDaysBefore] = useState(String(initial?.reminderDaysBefore ?? 3));
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      const body = {
        name: name.trim(),
        categoryId,
        paymentMethodId: paymentMethodId || null,
        scope,
        dueDay: Number(dueDay),
        amountType,
        amount: amountType === 'FIXED' ? Number(amount) : null,
        reminderDaysBefore: Number(reminderDaysBefore),
      };
      if (initial) {
        return api(`/recurring-payments/${initial.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      }
      return api('/recurring-payments', { method: 'POST', body: JSON.stringify(body) });
    },
    onSuccess: onDone,
    onError: (err) => setError(err instanceof Error ? err.message : 'Error'),
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    mutation.mutate();
  };

  return (
    <form className="card promo-form" onSubmit={onSubmit}>
      <div className="row-between">
        <h2>{initial ? 'Editar recurrente' : 'Nuevo recurrente'}</h2>
        <button type="button" className="icon-btn" onClick={onCancel} aria-label="Cerrar">
          ✕
        </button>
      </div>
      {initial?.amountType === 'FIXED' && (
        <p className="hint">Si cambiás el monto fijo, aplica desde ahora (los gastos anteriores no cambian).</p>
      )}
      <label>
        Nombre
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Luz, Gas, Gym…" required />
      </label>
      <label>
        Categoría
        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} required>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.icon} {c.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Medio de pago (opcional)
        <select value={paymentMethodId} onChange={(e) => setPaymentMethodId(e.target.value)}>
          <option value="">Usar el primero disponible</option>
          {(methods ? groupMethodsByEntity(methods) : []).flatMap((g) =>
            g.items.map((m) => (
              <option key={m.id} value={m.id}>
                {paymentMethodDisplayName(m)}
              </option>
            )),
          )}
        </select>
      </label>
      <div className="segmented">
        <button type="button" className={scope === 'HOUSEHOLD' ? 'active' : ''} onClick={() => setScope('HOUSEHOLD')}>
          Hogar
        </button>
        <button type="button" className={scope === 'PERSONAL' ? 'active' : ''} onClick={() => setScope('PERSONAL')}>
          Personal
        </button>
      </div>
      <div className="field-row">
        <label>
          Día de vencimiento
          <input
            type="number"
            min={1}
            max={28}
            value={dueDay}
            onChange={(e) => setDueDay(e.target.value)}
            required
          />
        </label>
        <label>
          Aviso (días antes)
          <input
            type="number"
            min={0}
            max={14}
            value={reminderDaysBefore}
            onChange={(e) => setReminderDaysBefore(e.target.value)}
          />
        </label>
      </div>
      <div className="segmented">
        <button type="button" className={amountType === 'FIXED' ? 'active' : ''} onClick={() => setAmountType('FIXED')}>
          Monto fijo
        </button>
        <button
          type="button"
          className={amountType === 'VARIABLE' ? 'active' : ''}
          onClick={() => setAmountType('VARIABLE')}
        >
          Variable
        </button>
      </div>
      {amountType === 'FIXED' && (
        <label>
          Monto $
          <input type="number" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required />
        </label>
      )}
      {error && <p className="error">{error}</p>}
      <div className="confirm-actions">
        <button type="button" className="btn-secondary" onClick={onCancel}>
          Cancelar
        </button>
        <button type="submit" className="btn-primary" disabled={mutation.isPending}>
          {mutation.isPending ? 'Guardando…' : 'Guardar'}
        </button>
      </div>
    </form>
  );
}
