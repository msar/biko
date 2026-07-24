import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ConfirmDialog from '../components/ConfirmDialog';
import { api, fmtARS, fmtDate, fmtMoneyExact, toArsDisplay } from '../lib/api';
import { useAuth } from '../lib/auth';
import { getOutbox, onOutboxChange, OutboxExpense } from '../lib/outbox';
import type { Purchase } from '../lib/types';

function splitLabel(exp: Purchase, userId: string): string | null {
  if (exp.scope === 'PERSONAL') return 'Personal';
  const myAlloc = exp.allocations?.find((a) => a.userId === userId);
  if (!myAlloc || !exp.allocations?.length) return null;
  const net = Number(exp.netAmount);
  const myAmount = Number(myAlloc.amount);
  if (exp.splitMode === 'ASSIGN') {
    if (myAmount >= net - 0.02) return 'Cargo: vos';
    if (myAmount <= 0.02) return 'Cargo: pareja';
  }
  const equalShare = net / exp.allocations.length;
  if (Math.abs(myAmount - equalShare) < 0.02) return null;
  return `Tu parte: ${fmtARS.format(myAmount)} / ${fmtARS.format(net)}`;
}

function payerLabel(exp: Purchase, userId: string): string | null {
  const payer = exp.paidBy ?? exp.paymentMethod.owner ?? null;
  if (!payer) return null;
  if (payer.id === exp.user.id) return null;
  return payer.id === userId ? 'Pagó: vos' : `Pagó: ${payer.name}`;
}

export default function ExpensesPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: expenses } = useQuery({
    queryKey: ['expenses'],
    queryFn: () => api<Purchase[]>('/expenses'),
  });

  const [pending, setPending] = useState<OutboxExpense[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<Purchase | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const refresh = () => void getOutbox().then(setPending);
    refresh();
    return onOutboxChange(refresh);
  }, []);

  const requestDelete = (exp: Purchase) => setDeleteTarget(exp);

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api(`/expenses/${deleteTarget.id}`, { method: 'DELETE' });
      setDeleteTarget(null);
      void queryClient.invalidateQueries({ queryKey: ['expenses'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    } finally {
      setDeleting(false);
    }
  };

  const startLongPress = (exp: Purchase) => {
    longPressTimer.current = setTimeout(() => {
      requestDelete(exp);
    }, 600);
  };

  const cancelLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  return (
    <div className="page">
      <header className="page-header">
        <h1>Gastos</h1>
      </header>

      {pending.length > 0 && (
        <section className="card pending-card">
          <h2>Pendientes de sincronizar ({pending.length})</h2>
          {pending.map((p) => (
            <div key={p.clientId} className="expense-row pending">
              <div>
                <strong>{p.store}</strong>
                <small>{fmtDate(p.purchaseDate)} · esperando conexión ⏳</small>
              </div>
              <span>{fmtARS.format(p.grossAmount)}</span>
            </div>
          ))}
        </section>
      )}

      {expenses?.map((exp) => {
        const badge = user ? splitLabel(exp, user.id) : null;
        const paidBadge = user ? payerLabel(exp, user.id) : null;
        return (
          <div
            key={exp.id}
            className="expense-row card expense-row-interactive"
            onClick={() => navigate(`/gastos/${exp.id}/edit`)}
            onTouchStart={() => startLongPress(exp)}
            onTouchEnd={cancelLongPress}
            onTouchMove={cancelLongPress}
            onContextMenu={(e) => {
              e.preventDefault();
              requestDelete(exp);
            }}
          >
            <div className="expense-cat" style={{ background: exp.category.color ?? '#ddd' }}>
              {exp.category.icon}
            </div>
            <div className="expense-main">
              <strong>{exp.store}</strong>
              <small>
                {fmtDate(exp.purchaseDate)} · cargó {exp.user.name} ·{' '}
                {exp.paymentMethod.nickname ?? exp.paymentMethod.definition.name}
                {exp.installmentsCount > 1 && ` · ${exp.installmentsCount} cuotas`}
              </small>
              {badge && <small className="expense-badge">{badge}</small>}
              {paidBadge && <small className="expense-badge">{paidBadge}</small>}
              {exp.debt && (
                <small className="expense-badge">
                  Deuda: {exp.debt.contact.name}
                  {exp.debt.direction === 'I_OWE' ? ' (les debés)' : ' (te deben)'}
                </small>
              )}
              {Number(exp.discountAmount) > 0 && (
                <small className="savings-tag">
                  ✨ {exp.discountLabelApplied ?? exp.promotion?.entity.name ?? 'Descuento'}: −
                  {fmtARS.format(Number(exp.discountAmount))}
                </small>
              )}
            </div>
            <div className="expense-amounts">
              {Number(exp.discountAmount) > 0 && (
                <small className="strike">
                  {fmtMoneyExact(Number(exp.grossAmount), exp.currency === 'USD' ? 'USD' : 'ARS')}
                </small>
              )}
              <span>{fmtMoneyExact(Number(exp.netAmount), exp.currency === 'USD' ? 'USD' : 'ARS')}</span>
              {exp.currency === 'USD' && (
                <small className="hint">
                  equiv. {fmtARS.format(toArsDisplay(Number(exp.netAmount), Number(exp.exchangeRateToArs ?? 1)))}
                </small>
              )}
            </div>
            <button
              type="button"
              className="expense-delete-btn"
              aria-label="Eliminar gasto"
              onClick={(e) => {
                e.stopPropagation();
                requestDelete(exp);
              }}
            >
              🗑
            </button>
          </div>
        );
      })}

      {expenses && expenses.length === 0 && pending.length === 0 && (
        <p className="empty-state">Sin gastos todavía.</p>
      )}
      <p className="hint center">Tocá un gasto para editarlo. Mantené presionado o usá 🗑 para eliminar.</p>

      <ConfirmDialog
        open={deleteTarget != null}
        title="¿Eliminar este gasto?"
        message={
          deleteTarget && (
            <>
              <strong>{deleteTarget.store}</strong>
              <span>
                {fmtDate(deleteTarget.purchaseDate)} · {fmtARS.format(Number(deleteTarget.netAmount))}
              </span>
              <span className="confirm-warning">Esta acción no se puede deshacer.</span>
            </>
          )
        }
        confirmLabel="Eliminar"
        cancelLabel="Cancelar"
        loading={deleting}
        onConfirm={() => void confirmDelete()}
        onCancel={() => !deleting && setDeleteTarget(null)}
      />
    </div>
  );
}
