import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import ConfirmDialog from '../components/ConfirmDialog';
import { IconButton } from '../components/ui';
import { api, fmtARS, fmtDate, fmtMoneyExact, toArsDisplay } from '../lib/api';
import { useAuth } from '../lib/auth';
import { expensePayerDisplayName, expensePaymentRows, expenseSplitLabel } from '../lib/expense-labels';
import { paymentMethodDisplayName } from '../lib/payment-method-catalog';
import type { Purchase } from '../lib/types';

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="expense-detail-row">
      <span className="expense-detail-label">{label}</span>
      <span className="expense-detail-value">{children}</span>
    </div>
  );
}

export default function ExpenseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const online = typeof navigator !== 'undefined' ? navigator.onLine : true;

  const { data: purchase, isLoading, error } = useQuery({
    queryKey: ['expenses', id],
    queryFn: () => api<Purchase>(`/expenses/${id}`),
    enabled: Boolean(id),
  });

  const deleteMutation = useMutation({
    mutationFn: () => api(`/expenses/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['expenses'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      navigate('/gastos');
    },
  });

  if (!id) return <Navigate to="/gastos" replace />;

  if (isLoading && !purchase) {
    return <div className="page-loading">Cargando…</div>;
  }

  if (error || !purchase || !user) {
    return (
      <div className="page">
        <header className="page-header">
          <IconButton icon="arrow_back" label="Volver" onClick={() => navigate('/gastos')} />
          <h1>Gasto</h1>
          <span />
        </header>
        <p className="error">No se pudo cargar el gasto.</p>
      </div>
    );
  }

  const currency = purchase.currency === 'USD' ? 'USD' : 'ARS';
  const gross = Number(purchase.grossAmount);
  const net = Number(purchase.netAmount);
  const discount = Number(purchase.discountAmount);
  const split = expenseSplitLabel(purchase, user.id);
  const payerName = expensePayerDisplayName(purchase, user.id);
  const paymentRows = expensePaymentRows(purchase);

  return (
    <div className="page">
      <header className="page-header">
        <IconButton icon="arrow_back" label="Volver" onClick={() => navigate('/gastos')} />
        <h1>Detalle</h1>
        <span />
      </header>

      <section className="card expense-detail-hero">
        <div className="expense-detail-hero-top">
          <div className="expense-cat" style={{ background: purchase.category.color ?? '#ddd' }}>
            {purchase.category.icon}
          </div>
          <div>
            <strong className="expense-detail-store">{purchase.store}</strong>
            <small>{fmtDate(purchase.purchaseDate)}</small>
          </div>
        </div>
        <div className="expense-detail-net">
          {discount > 0 && (
            <small className="strike">{fmtMoneyExact(gross, currency)}</small>
          )}
          <span>{fmtMoneyExact(net, currency)}</span>
          {currency === 'USD' && (
            <small className="hint">
              equiv. {fmtARS.format(toArsDisplay(net, Number(purchase.exchangeRateToArs ?? 1)))}
            </small>
          )}
        </div>
      </section>

      <section className="card">
        <h2>Resumen</h2>
        {purchase.description && <DetailRow label="Descripción">{purchase.description}</DetailRow>}
        <DetailRow label="Categoría">
          {purchase.category.icon} {purchase.category.name}
        </DetailRow>
        <DetailRow label="Medio de pago">{paymentMethodDisplayName(purchase.paymentMethod)}</DetailRow>
        <DetailRow label="Tipo">{purchase.scope === 'PERSONAL' ? 'Personal' : 'Hogar'}</DetailRow>
        {split && <DetailRow label="Reparto">{split}</DetailRow>}
        <DetailRow label="Pagó">{payerName}</DetailRow>
        {purchase.sourceTrip && (
          <DetailRow label="Viaje">
            <Link to={`/viajes/${purchase.sourceTrip.id}`}>{purchase.sourceTrip.name}</Link>
          </DetailRow>
        )}
        <DetailRow label="Cargó">{purchase.user.name}</DetailRow>
        {discount > 0 && (
          <DetailRow label="Descuento">
            {purchase.discountLabelApplied ?? purchase.promotion?.entity.name ?? 'Descuento'}: −
            {fmtMoneyExact(discount, currency)}
          </DetailRow>
        )}
        {purchase.debt && (
          <DetailRow label="Deuda">
            {purchase.debt.contact.name}
            {purchase.debt.direction === 'I_OWE' ? ' (les debés)' : ' (te deben)'}
          </DetailRow>
        )}
      </section>

      {paymentRows.length > 1 && (
        <section className="card">
          <h2>Pagos</h2>
          {paymentRows.map((p) => (
            <DetailRow key={p.userId} label={p.userId === user.id ? 'Vos' : p.name}>
              {fmtMoneyExact(p.amount, currency)}
            </DetailRow>
          ))}
        </section>
      )}

      {purchase.allocations?.length > 0 && purchase.scope === 'HOUSEHOLD' && (
        <section className="card">
          <h2>Partes</h2>
          {purchase.allocations.map((a) => (
            <DetailRow key={a.userId} label={a.user.name}>
              {fmtMoneyExact(Number(a.amount), currency)}
            </DetailRow>
          ))}
        </section>
      )}

      {purchase.installments?.length > 0 && (
        <section className="card">
          <h2>Cuotas {purchase.installmentsCount > 1 ? `(${purchase.installmentsCount})` : ''}</h2>
          {purchase.installments.map((inst) => (
            <DetailRow key={inst.id} label={`Cuota ${inst.number}`}>
              {fmtMoneyExact(Number(inst.amount), currency)} · {fmtDate(inst.dueDate)}
              {inst.paid ? ' · pagada' : ''}
            </DetailRow>
          ))}
        </section>
      )}

      {!online && (
        <p className="hint center">Sin conexión: podés ver el gasto, pero editar o eliminar requiere internet.</p>
      )}

      <div className="confirm-actions expense-detail-actions">
        <button
          type="button"
          className="btn-primary"
          disabled={!online}
          onClick={() => navigate(`/gastos/${id}/edit`)}
        >
          Editar
        </button>
        <button
          type="button"
          className="btn-danger"
          disabled={!online || deleteMutation.isPending}
          onClick={() => setConfirmDelete(true)}
        >
          Eliminar
        </button>
      </div>
      <p className="hint center">
        <Link to="/gastos">Volver a gastos</Link>
      </p>

      <ConfirmDialog
        open={confirmDelete}
        title="¿Eliminar este gasto?"
        message={
          <>
            <strong>{purchase.store}</strong>
            <span>
              {fmtDate(purchase.purchaseDate)} · {fmtMoneyExact(net, currency)}
            </span>
            <span className="confirm-warning">Esta acción no se puede deshacer.</span>
          </>
        }
        confirmLabel="Eliminar"
        cancelLabel="Cancelar"
        loading={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate()}
        onCancel={() => !deleteMutation.isPending && setConfirmDelete(false)}
      />
    </div>
  );
}
