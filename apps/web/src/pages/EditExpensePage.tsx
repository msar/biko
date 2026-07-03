import { useQuery } from '@tanstack/react-query';
import { Navigate, useParams } from 'react-router-dom';
import ExpenseForm, { initialFromPurchase } from '../components/ExpenseForm';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { Purchase } from '../lib/types';

export default function EditExpensePage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();

  const { data: purchase, isLoading, error } = useQuery({
    queryKey: ['expenses', id],
    queryFn: () => api<Purchase>(`/expenses/${id}`),
    enabled: Boolean(id),
  });

  if (!id) return <Navigate to="/gastos" replace />;

  if (!navigator.onLine) {
    return (
      <div className="page">
        <div className="offline-saved">
          <span className="big-emoji">📴</span>
          <h2>Sin conexión</h2>
          <p>Editar gastos requiere conexión a internet.</p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return <div className="page-loading">Cargando…</div>;
  }

  if (error || !purchase || !user) {
    return (
      <div className="page">
        <p className="error">No se pudo cargar el gasto.</p>
      </div>
    );
  }

  return (
    <ExpenseForm
      mode="edit"
      purchaseId={id}
      initial={initialFromPurchase(purchase, user.id)}
      title="Editar gasto"
    />
  );
}
