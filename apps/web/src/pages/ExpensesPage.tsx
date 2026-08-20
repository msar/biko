import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import ConfirmDialog from '../components/ConfirmDialog';
import { Button, Icon, IconButton } from '../components/ui';
import { api, fmtARS, fmtDate, fmtMoneyExact, toArsDisplay } from '../lib/api';
import { useAuth } from '../lib/auth';
import { expensePayerLabel, expenseSplitLabel } from '../lib/expense-labels';
import { isTripExportDescription } from '../lib/trip-export-ui';
import { getOutbox, onOutboxChange, OutboxExpense } from '../lib/outbox';
import type { Purchase } from '../lib/types';

/** Matches GET /expenses default; keep in sync with API `listQuerySchema`. */
const PAGE_SIZE = 10;

function expensesListUrl(offset: number): string {
  const params = new URLSearchParams({
    limit: String(PAGE_SIZE),
    offset: String(offset),
  });
  return `/expenses?${params}`;
}

export default function ExpensesPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
  } = useInfiniteQuery({
    queryKey: ['expenses', 'list'],
    queryFn: ({ pageParam }) => api<Purchase[]>(expensesListUrl(pageParam)),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      if (lastPage.length < PAGE_SIZE) return undefined;
      return allPages.reduce((sum, page) => sum + page.length, 0);
    },
  });

  const expenses = data?.pages.flat() ?? [];

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
        <Button to="/importar-resumen" variant="text" size="sm">
          Importar resumen
        </Button>
      </header>

      {pending.length > 0 && (
        <section className="card pending-card">
          <h2>Pendientes de sincronizar ({pending.length})</h2>
          {pending.map((p) => (
            <div key={p.clientId} className="expense-row pending">
              <div>
                <strong>{p.store}</strong>
                <small>{fmtDate(p.purchaseDate)} · esperando conexión</small>
              </div>
              <span>{fmtARS.format(p.grossAmount)}</span>
            </div>
          ))}
        </section>
      )}

      {expenses.map((exp) => {
        const badge = user ? expenseSplitLabel(exp, user.id) : null;
        const paidBadge = user ? expensePayerLabel(exp, user.id) : null;
        return (
          <div
            key={exp.id}
            className="expense-row card expense-row-interactive"
            onClick={() => navigate(`/gastos/${exp.id}`)}
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
              {isTripExportDescription(exp.description) && (
                <small className="expense-export-label">{exp.description}</small>
              )}
              {exp.sourceTrip && (
                <small className="expense-export-label">
                  <Link
                    to={`/viajes/${exp.sourceTrip.id}`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    Ver viaje: {exp.sourceTrip.name}
                  </Link>
                </small>
              )}
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
            <IconButton
              icon="delete"
              label="Eliminar gasto"
              className="expense-delete-btn"
              onClick={(e) => {
                e.stopPropagation();
                requestDelete(exp);
              }}
            />
          </div>
        );
      })}

      {!isLoading && expenses.length === 0 && pending.length === 0 && (
        <div className="empty-state md-empty">
          <Icon name="receipt_long" />
          <p>Sin gastos todavía.</p>
          <Button to="/nuevo" variant="filled">
            Cargar un gasto
          </Button>
        </div>
      )}

      {hasNextPage && (
        <Button
          variant="outlined"
          block
          className="load-more-btn"
          disabled={isFetchingNextPage}
          onClick={() => void fetchNextPage()}
        >
          {isFetchingNextPage ? 'Cargando…' : 'Cargar más'}
        </Button>
      )}

      <p className="hint center">Tocá un gasto para verlo. Mantené presionado o usá eliminar para borrarlo.</p>

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
