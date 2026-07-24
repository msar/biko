import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import ConfirmDialog from '../components/ConfirmDialog';
import { api, fmtARS, fmtDate, fmtMoneyExact } from '../lib/api';
import type { Contact, Debt, DebtDirection, DebtSummary } from '../lib/types';

type ContactsPicker = {
  select: (
    properties: string[],
    options?: { multiple?: boolean },
  ) => Promise<Array<Record<string, Array<{ tel?: string; email?: string }> | string>>>;
  getProperties: () => Promise<string[]>;
};

function getContactsApi(): ContactsPicker | null {
  const nav = navigator as Navigator & { contacts?: ContactsPicker };
  return nav.contacts ?? null;
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function debtProgress(debt: Debt): { paid: number; next: Debt['installments'][0] | null } {
  const paid = debt.installments.filter((i) => i.paid).length;
  const next = debt.installments.find((i) => !i.paid) ?? null;
  return { paid, next };
}

export default function DebtsPage() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payTarget, setPayTarget] = useState<{ debt: Debt; number: number } | null>(null);
  const [showSettled, setShowSettled] = useState(false);

  const { data: summary } = useQuery({
    queryKey: ['debts-summary'],
    queryFn: () => api<DebtSummary>('/debts/summary'),
  });
  const { data: debts } = useQuery({
    queryKey: ['debts'],
    queryFn: () => api<Debt[]>('/debts'),
  });
  const { data: contacts } = useQuery({
    queryKey: ['contacts'],
    queryFn: () => api<Contact[]>('/contacts'),
  });

  const openDebts = useMemo(() => debts?.filter((d) => d.status === 'OPEN') ?? [], [debts]);
  const settledDebts = useMemo(() => debts?.filter((d) => d.status === 'SETTLED') ?? [], [debts]);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['debts'] });
    void queryClient.invalidateQueries({ queryKey: ['debts-summary'] });
    void queryClient.invalidateQueries({ queryKey: ['contacts'] });
    void queryClient.invalidateQueries({ queryKey: ['expenses'] });
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const payMutation = useMutation({
    mutationFn: ({ debtId, number }: { debtId: string; number: number }) =>
      api(`/debts/${debtId}/installments/${number}/pay`, {
        method: 'POST',
        body: JSON.stringify({}),
      }),
    onSuccess: () => {
      setPayTarget(null);
      invalidate();
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Error'),
  });

  const groupedOpen = useMemo(() => {
    const map = new Map<string, { contactName: string; debts: Debt[] }>();
    for (const debt of openDebts) {
      const entry = map.get(debt.contact.id) ?? { contactName: debt.contact.name, debts: [] };
      entry.debts.push(debt);
      map.set(debt.contact.id, entry);
    }
    return [...map.entries()].sort((a, b) => a[1].contactName.localeCompare(b[1].contactName, 'es'));
  }, [openDebts]);

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Deudas</h1>
          <p className="hint">Prestamos y reintegros con contactos fuera del hogar.</p>
        </div>
        <button
          type="button"
          className="icon-btn"
          onClick={() => {
            setError(null);
            setShowForm((v) => !v);
          }}
          aria-label="Agregar deuda"
        >
          {showForm ? '✕' : '＋'}
        </button>
      </header>

      {error && <p className="error">{error}</p>}

      {summary && (
        <section className="card hero-card">
          <div className="row-between">
            <div>
              <small className="hint">Te deben este mes</small>
              <strong className="balance-pos">{fmtARS.format(summary.owedToMeThisMonth)}</strong>
            </div>
            <div style={{ textAlign: 'right' }}>
              <small className="hint">Debés este mes</small>
              <strong className="balance-neg">{fmtARS.format(summary.iOweThisMonth)}</strong>
            </div>
          </div>
          <div className="row-between" style={{ marginTop: '0.75rem' }}>
            <small className="hint">Pendiente a cobrar: {fmtARS.format(summary.owedToMeRemaining)}</small>
            <small className="hint">Pendiente a pagar: {fmtARS.format(summary.iOweRemaining)}</small>
          </div>
        </section>
      )}

      {showForm && contacts && (
        <DebtForm
          contacts={contacts}
          onDone={() => {
            setShowForm(false);
            invalidate();
          }}
          onCancel={() => setShowForm(false)}
          onError={setError}
        />
      )}

      <section className="card">
        <h2>Abiertas</h2>
        {groupedOpen.length === 0 && <p className="hint">No hay deudas abiertas.</p>}
        {groupedOpen.map(([contactId, group]) => (
          <div key={contactId} className="debt-contact-group">
            <h3 className="payment-method-group-title">{group.contactName}</h3>
            {group.debts.map((debt) => {
              const { paid, next } = debtProgress(debt);
              return (
                <div key={debt.id} className="list-row">
                  <div>
                    <strong>{debt.title}</strong>
                    <small>
                      {debt.direction === 'OWED_TO_ME' ? 'Te deben' : 'Les debés'} ·{' '}
                      {fmtMoneyExact(Number(debt.totalAmount), debt.currency === 'USD' ? 'USD' : 'ARS')}
                      {debt.installmentsCount > 1 && ` · cuota ${paid}/${debt.installmentsCount}`}
                      {debt.purchaseId && ' · tarjeta'}
                    </small>
                    {next && (
                      <small>
                        Próxima: {fmtMoneyExact(Number(next.amount), debt.currency === 'USD' ? 'USD' : 'ARS')} ·{' '}
                        {fmtDate(next.dueDate)}
                      </small>
                    )}
                  </div>
                  <div className="list-row-actions">
                    {next && (
                      <button
                        type="button"
                        className="btn-link"
                        onClick={() => setPayTarget({ debt, number: next.number })}
                      >
                        Registrar pago
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </section>

      {settledDebts.length > 0 && (
        <section className="card">
          <div className="row-between">
            <h2>Saldadas</h2>
            <button type="button" className="btn-link" onClick={() => setShowSettled((v) => !v)}>
              {showSettled ? 'Ocultar' : `Ver (${settledDebts.length})`}
            </button>
          </div>
          {showSettled &&
            settledDebts.map((debt) => (
              <div key={debt.id} className="list-row">
                <div>
                  <strong>{debt.title}</strong>
                  <small>
                    {debt.contact.name} ·{' '}
                    {fmtMoneyExact(Number(debt.totalAmount), debt.currency === 'USD' ? 'USD' : 'ARS')}
                  </small>
                </div>
              </div>
            ))}
        </section>
      )}

      <p className="hint center">
        <Link to="/ajustes">← Volver a ajustes</Link>
      </p>

      <ConfirmDialog
        open={payTarget != null}
        title="¿Registrar pago de cuota?"
        message={
          payTarget && (
            <>
              <strong>{payTarget.debt.title}</strong>
              <span>
                Cuota {payTarget.number} ·{' '}
                {fmtMoneyExact(
                  Number(payTarget.debt.installments.find((i) => i.number === payTarget.number)?.amount ?? 0),
                  payTarget.debt.currency === 'USD' ? 'USD' : 'ARS',
                )}
              </span>
            </>
          )
        }
        confirmLabel="Registrar"
        cancelLabel="Cancelar"
        loading={payMutation.isPending}
        onConfirm={() => {
          if (!payTarget) return;
          payMutation.mutate({ debtId: payTarget.debt.id, number: payTarget.number });
        }}
        onCancel={() => !payMutation.isPending && setPayTarget(null)}
      />
    </div>
  );
}

function DebtForm({
  contacts,
  onDone,
  onCancel,
  onError,
}: {
  contacts: Contact[];
  onDone: () => void;
  onCancel: () => void;
  onError: (msg: string | null) => void;
}) {
  const [contactMode, setContactMode] = useState<'existing' | 'new'>(
    contacts.length > 0 ? 'existing' : 'new',
  );
  const [contactId, setContactId] = useState(contacts[0]?.id ?? '');
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [direction, setDirection] = useState<DebtDirection>('OWED_TO_ME');
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [installmentsCount, setInstallmentsCount] = useState('1');
  const [startDate, setStartDate] = useState(todayIso());
  const [saving, setSaving] = useState(false);
  const contactsApi = getContactsApi();

  const pickPhoneContact = async () => {
    if (!contactsApi) return;
    try {
      const props = await contactsApi.getProperties();
      const wanted = ['name', 'tel'].filter((p) => props.includes(p));
      if (wanted.length === 0) return;
      const picked = await contactsApi.select(wanted, { multiple: false });
      const first = picked[0];
      if (!first) return;
      const nameField = first.name;
      const telField = first.tel;
      const name = Array.isArray(nameField) ? String(nameField[0] ?? '') : String(nameField ?? '');
      const telRaw = Array.isArray(telField) ? telField[0] : telField;
      const phone =
        typeof telRaw === 'object' && telRaw && 'tel' in telRaw
          ? String(telRaw.tel ?? '')
          : String(telRaw ?? '');
      if (name) {
        setContactMode('new');
        setNewName(name);
        setNewPhone(phone);
      }
    } catch {
      // User cancelled or unsupported — ignore
    }
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    onError(null);
    const totalAmount = Number(amount);
    const count = Number(installmentsCount);
    if (!(totalAmount > 0)) {
      onError('Ingresá un monto válido');
      return;
    }
    if (contactMode === 'existing' && !contactId) {
      onError('Elegí un contacto');
      return;
    }
    if (contactMode === 'new' && !newName.trim()) {
      onError('Ingresá el nombre del contacto');
      return;
    }
    setSaving(true);
    try {
      await api('/debts', {
        method: 'POST',
        body: JSON.stringify({
          ...(contactMode === 'existing'
            ? { contactId }
            : { newContact: { name: newName.trim(), phone: newPhone.trim() || null } }),
          direction,
          title: title.trim() || (contactMode === 'new' ? newName.trim() : 'Deuda'),
          totalAmount,
          installmentsCount: count,
          startDate,
          currency: 'ARS',
        }),
      });
      onDone();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Error al guardar');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="card promo-form" onSubmit={(e) => void onSubmit(e)}>
      <h2>Nueva deuda</h2>

      <div className="segmented">
        <button
          type="button"
          className={direction === 'OWED_TO_ME' ? 'active' : ''}
          onClick={() => setDirection('OWED_TO_ME')}
        >
          Me deben
        </button>
        <button
          type="button"
          className={direction === 'I_OWE' ? 'active' : ''}
          onClick={() => setDirection('I_OWE')}
        >
          Debo
        </button>
      </div>

      <div className="segmented" style={{ marginTop: '0.75rem' }}>
        <button
          type="button"
          className={contactMode === 'existing' ? 'active' : ''}
          onClick={() => setContactMode('existing')}
          disabled={contacts.length === 0}
        >
          Contacto
        </button>
        <button
          type="button"
          className={contactMode === 'new' ? 'active' : ''}
          onClick={() => setContactMode('new')}
        >
          Nuevo
        </button>
      </div>

      {contactMode === 'existing' ? (
        <label>
          Contacto
          <select value={contactId} onChange={(e) => setContactId(e.target.value)} required>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <>
          <label>
            Nombre
            <input value={newName} onChange={(e) => setNewName(e.target.value)} required />
          </label>
          <label>
            Teléfono (opcional)
            <input value={newPhone} onChange={(e) => setNewPhone(e.target.value)} />
          </label>
          {contactsApi && (
            <button type="button" className="btn-secondary" onClick={() => void pickPhoneContact()}>
              Elegir del teléfono
            </button>
          )}
        </>
      )}

      <label>
        Concepto
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ej. Cena, pasaje…" />
      </label>
      <div className="field-row">
        <label>
          Monto $
          <input
            type="number"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
          />
        </label>
        <label>
          Cuotas
          <input
            type="number"
            min={1}
            max={36}
            value={installmentsCount}
            onChange={(e) => setInstallmentsCount(e.target.value)}
            required
          />
        </label>
      </div>
      <label>
        Fecha inicio
        <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
      </label>

      <div className="confirm-actions">
        <button type="button" className="btn-secondary" onClick={onCancel}>
          Cancelar
        </button>
        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? 'Guardando…' : 'Crear deuda'}
        </button>
      </div>
    </form>
  );
}
