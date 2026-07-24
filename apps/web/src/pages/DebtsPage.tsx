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

function debtMoney(debt: Debt, amount: number): string {
  return fmtMoneyExact(amount, debt.currency === 'USD' ? 'USD' : 'ARS');
}

function debtProgress(debt: Debt) {
  const paidCount = debt.installments.filter((i) => i.paid).length;
  const paidAmount = debt.installments
    .filter((i) => i.paid)
    .reduce((s, i) => s + Number(i.amount), 0);
  const remainingAmount = debt.installments
    .filter((i) => !i.paid)
    .reduce((s, i) => s + Number(i.amount), 0);
  const next = debt.installments.find((i) => !i.paid) ?? null;
  return { paidCount, paidAmount, remainingAmount, next };
}

/** Digits only; keep leading country code if present, else assume AR (+54). */
function normalizeWhatsAppPhone(phone: string): string | null {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 8) return null;
  if (digits.startsWith('54')) return digits;
  if (digits.startsWith('0')) return `54${digits.slice(1)}`;
  return `54${digits}`;
}

function whatsappReminderUrl(debt: Debt): string | null {
  const phone = debt.contact.phone;
  if (!phone) return null;
  const normalized = normalizeWhatsAppPhone(phone);
  if (!normalized) return null;

  const { next, remainingAmount, paidCount } = debtProgress(debt);
  const currency = debt.currency === 'USD' ? 'USD' : 'ARS';
  const nextLine = next
    ? `La próxima cuota es de ${fmtMoneyExact(Number(next.amount), currency)} (vence ${fmtDate(next.dueDate)}).`
    : '';
  const progress =
    debt.installmentsCount > 1
      ? `Llevás ${paidCount} de ${debt.installmentsCount} cuotas. Quedan ${fmtMoneyExact(remainingAmount, currency)}.`
      : `El monto pendiente es ${fmtMoneyExact(remainingAmount, currency)}.`;

  const text =
    debt.direction === 'OWED_TO_ME'
      ? `Hola ${debt.contact.name}! Te escribo por “${debt.title}”. ${progress} ${nextLine}`.trim()
      : `Hola ${debt.contact.name}! Sobre “${debt.title}”: ${progress} ${nextLine}`.trim();

  return `https://wa.me/${normalized}?text=${encodeURIComponent(text)}`;
}

export default function DebtsPage() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editDebt, setEditDebt] = useState<Debt | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [payTarget, setPayTarget] = useState<{ debt: Debt; number: number } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Debt | null>(null);
  const [showSettled, setShowSettled] = useState(true);

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

  const unpayMutation = useMutation({
    mutationFn: ({ debtId, number }: { debtId: string; number: number }) =>
      api(`/debts/${debtId}/installments/${number}/unpay`, {
        method: 'POST',
        body: JSON.stringify({}),
      }),
    onSuccess: invalidate,
    onError: (err) => setError(err instanceof Error ? err.message : 'Error'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api(`/debts/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      setDeleteTarget(null);
      invalidate();
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Error'),
  });

  const reopenMutation = useMutation({
    mutationFn: (id: string) => api(`/debts/${id}/reopen`, { method: 'POST', body: '{}' }),
    onSuccess: invalidate,
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
          <p className="hint">Préstamos y reintegros con contactos fuera del hogar.</p>
        </div>
        <button
          type="button"
          className="icon-btn"
          onClick={() => {
            setError(null);
            setEditDebt(null);
            setShowForm((v) => !v);
          }}
          aria-label="Agregar deuda"
        >
          {showForm && !editDebt ? '✕' : '＋'}
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

      {(showForm || editDebt) && contacts && (
        <DebtForm
          contacts={contacts}
          initial={editDebt}
          onDone={() => {
            setShowForm(false);
            setEditDebt(null);
            invalidate();
          }}
          onCancel={() => {
            setShowForm(false);
            setEditDebt(null);
          }}
          onError={setError}
        />
      )}

      <section className="card">
        <h2>Abiertas</h2>
        {groupedOpen.length === 0 && <p className="hint">No hay deudas abiertas.</p>}
        {groupedOpen.map(([contactId, group]) => (
          <div key={contactId} className="debt-contact-group">
            <h3 className="payment-method-group-title">{group.contactName}</h3>
            {group.debts.map((debt) => (
              <DebtRow
                key={debt.id}
                debt={debt}
                expanded={expandedId === debt.id}
                onToggle={() => setExpandedId((id) => (id === debt.id ? null : debt.id))}
                onPay={(number) => setPayTarget({ debt, number })}
                onUnpay={(number) => unpayMutation.mutate({ debtId: debt.id, number })}
                onEdit={() => {
                  setShowForm(false);
                  setEditDebt(debt);
                }}
                onDelete={() => setDeleteTarget(debt)}
              />
            ))}
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
              <div key={debt.id} className="list-row debt-row">
                <div>
                  <strong>{debt.title}</strong>
                  <small>
                    {debt.contact.name} · {debtMoney(debt, Number(debt.totalAmount))}
                  </small>
                </div>
                <div className="list-row-actions">
                  <button
                    type="button"
                    className="btn-link"
                    onClick={() => reopenMutation.mutate(debt.id)}
                    disabled={reopenMutation.isPending}
                  >
                    Reabrir
                  </button>
                  <button type="button" className="btn-link" onClick={() => setDeleteTarget(debt)}>
                    Eliminar
                  </button>
                </div>
              </div>
            ))}
          {showSettled && (
            <p className="hint">
              Si una deuda de tarjeta quedó saldada por error al importar, usá <strong>Reabrir</strong>.
            </p>
          )}
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
                {debtMoney(
                  payTarget.debt,
                  Number(payTarget.debt.installments.find((i) => i.number === payTarget.number)?.amount ?? 0),
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

      <ConfirmDialog
        open={deleteTarget != null}
        title="¿Eliminar esta deuda?"
        message={
          deleteTarget && (
            <>
              <strong>{deleteTarget.title}</strong>
              <span>
                {deleteTarget.contact.name} · {debtMoney(deleteTarget, Number(deleteTarget.totalAmount))}
              </span>
              <span className="confirm-warning">Se borran también las cuotas registradas.</span>
            </>
          )
        }
        confirmLabel="Eliminar"
        cancelLabel="Cancelar"
        loading={deleteMutation.isPending}
        onConfirm={() => {
          if (!deleteTarget) return;
          deleteMutation.mutate(deleteTarget.id);
        }}
        onCancel={() => !deleteMutation.isPending && setDeleteTarget(null)}
      />
    </div>
  );
}

function DebtRow({
  debt,
  expanded,
  onToggle,
  onPay,
  onUnpay,
  onEdit,
  onDelete,
}: {
  debt: Debt;
  expanded: boolean;
  onToggle: () => void;
  onPay: (number: number) => void;
  onUnpay: (number: number) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { paidCount, paidAmount, remainingAmount, next } = debtProgress(debt);
  const waUrl = whatsappReminderUrl(debt);

  return (
    <div className="debt-row-block">
      <div className="list-row debt-row">
        <button type="button" className="debt-row-main" onClick={onToggle}>
          <strong>{debt.title}</strong>
          <small>
            {debt.direction === 'OWED_TO_ME' ? 'Te deben' : 'Les debés'} ·{' '}
            {debtMoney(debt, Number(debt.totalAmount))}
            {debt.installmentsCount > 1 && ` · cuota ${paidCount}/${debt.installmentsCount}`}
            {debt.purchaseId && ' · tarjeta'}
          </small>
          <small>
            Pagado {debtMoney(debt, paidAmount)} · queda {debtMoney(debt, remainingAmount)}
          </small>
          {next && (
            <small>
              Próxima: {debtMoney(debt, Number(next.amount))} · {fmtDate(next.dueDate)}
            </small>
          )}
        </button>
        <div className="list-row-actions">
          {next && (
            <button type="button" className="btn-link" onClick={() => onPay(next.number)}>
              Registrar pago
            </button>
          )}
          {waUrl && (
            <a className="btn-link" href={waUrl} target="_blank" rel="noreferrer">
              WhatsApp
            </a>
          )}
          <button type="button" className="btn-link" onClick={onEdit}>
            Editar
          </button>
          <button type="button" className="btn-link" onClick={onDelete}>
            Eliminar
          </button>
        </div>
      </div>

      {expanded && (
        <ul className="debt-installments">
          {debt.installments.map((inst) => (
            <li key={inst.id} className={inst.paid ? 'paid' : ''}>
              <span>
                Cuota {inst.number}/{debt.installmentsCount} · {debtMoney(debt, Number(inst.amount))} ·{' '}
                {fmtDate(inst.dueDate)}
                {inst.paid && inst.paidDate ? ` · pagada ${fmtDate(inst.paidDate)}` : ''}
              </span>
              {inst.paid ? (
                <button type="button" className="btn-link" onClick={() => onUnpay(inst.number)}>
                  Deshacer
                </button>
              ) : (
                <button type="button" className="btn-link" onClick={() => onPay(inst.number)}>
                  Pagar
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DebtForm({
  contacts,
  initial,
  onDone,
  onCancel,
  onError,
}: {
  contacts: Contact[];
  initial?: Debt | null;
  onDone: () => void;
  onCancel: () => void;
  onError: (msg: string | null) => void;
}) {
  const editing = Boolean(initial);
  const [contactMode, setContactMode] = useState<'existing' | 'new'>(
    contacts.length > 0 || editing ? 'existing' : 'new',
  );
  const [contactId, setContactId] = useState(initial?.contact.id ?? contacts[0]?.id ?? '');
  const [contactPhone, setContactPhone] = useState(
    initial?.contact.phone ?? contacts.find((c) => c.id === (initial?.contact.id ?? contacts[0]?.id))?.phone ?? '',
  );
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [direction, setDirection] = useState<DebtDirection>(initial?.direction ?? 'OWED_TO_ME');
  const [title, setTitle] = useState(initial?.title ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [amount, setAmount] = useState(initial ? String(Number(initial.totalAmount)) : '');
  const [installmentsCount, setInstallmentsCount] = useState(
    initial ? String(initial.installmentsCount) : '1',
  );
  const [startDate, setStartDate] = useState(
    initial ? initial.startDate.slice(0, 10) : todayIso(),
  );
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

    if (editing && initial) {
      if (!title.trim()) {
        onError('Ingresá un concepto');
        return;
      }
      if (!contactId) {
        onError('Elegí un contacto');
        return;
      }
      setSaving(true);
      try {
        await api(`/debts/${initial.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            title: title.trim(),
            notes: notes.trim() || null,
            direction,
            contactId,
          }),
        });
        await api(`/contacts/${contactId}`, {
          method: 'PATCH',
          body: JSON.stringify({ phone: contactPhone.trim() || null }),
        });
        onDone();
      } catch (err) {
        onError(err instanceof Error ? err.message : 'Error al guardar');
      } finally {
        setSaving(false);
      }
      return;
    }

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
          notes: notes.trim() || null,
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
      <h2>{editing ? 'Editar deuda' : 'Nueva deuda'}</h2>

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

      {!editing && (
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
      )}

      {editing || contactMode === 'existing' ? (
        <>
          <label>
            Contacto
            <select
              value={contactId}
              onChange={(e) => {
                const id = e.target.value;
                setContactId(id);
                setContactPhone(contacts.find((c) => c.id === id)?.phone ?? '');
              }}
              required
            >
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.phone ? ` · ${c.phone}` : ''}
                </option>
              ))}
            </select>
          </label>
          {editing && (
            <label>
              Teléfono (WhatsApp)
              <input
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
                placeholder="Ej. 11 1234-5678"
              />
            </label>
          )}
        </>
      ) : (
        <>
          <label>
            Nombre
            <input value={newName} onChange={(e) => setNewName(e.target.value)} required />
          </label>
          <label>
            Teléfono (WhatsApp)
            <input
              value={newPhone}
              onChange={(e) => setNewPhone(e.target.value)}
              placeholder="Ej. 11 1234-5678"
            />
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
      <label>
        Notas (opcional)
        <input value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>

      {!editing && (
        <>
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
        </>
      )}

      {editing && (
        <p className="hint">El monto y las cuotas se gestionan marcando cada pago abajo en el detalle.</p>
      )}

      <div className="confirm-actions">
        <button type="button" className="btn-secondary" onClick={onCancel}>
          Cancelar
        </button>
        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? 'Guardando…' : editing ? 'Guardar' : 'Crear deuda'}
        </button>
      </div>
    </form>
  );
}
