import { ARGENTINE_PROVINCES } from '@biko/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { PaymentMethod, PaymentMethodDefinition } from '../lib/types';

function AddMethodForm({ definitions, onDone }: { definitions: PaymentMethodDefinition[]; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [definitionId, setDefinitionId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const selected = definitions.find((d) => d.id === definitionId);
  const isCredit = selected?.type === 'CREDIT_CARD';
  const isCard = isCredit || selected?.type === 'DEBIT_CARD';

  const mutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api('/payment-methods', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['payment-methods'] });
      onDone();
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Error'),
  });

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    mutation.mutate({
      definitionId,
      nickname: String(data.get('nickname')) || null,
      lastFour: String(data.get('lastFour')) || null,
      closingDay: data.get('closingDay') ? Number(data.get('closingDay')) : null,
      dueDay: data.get('dueDay') ? Number(data.get('dueDay')) : null,
    });
  };

  return (
    <form className="card promo-form" onSubmit={onSubmit}>
      <h2>Agregar medio de pago</h2>
      <label>
        Medio de pago (catálogo estándar)
        <select value={definitionId} onChange={(e) => setDefinitionId(e.target.value)} required>
          <option value="">Elegí uno…</option>
          {definitions.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </label>
      {isCard && (
        <label>
          Últimos 4 dígitos
          <input name="lastFour" pattern="\d{4}" maxLength={4} placeholder="1234" />
        </label>
      )}
      {isCredit && (
        <div className="field-row">
          <label>
            Día de cierre
            <input name="closingDay" type="number" min="1" max="31" required placeholder="15" />
          </label>
          <label>
            Día de vencimiento
            <input name="dueDay" type="number" min="1" max="31" required placeholder="10" />
          </label>
        </div>
      )}
      <label>
        Apodo (opcional)
        <input name="nickname" placeholder="La Visa de Mariano" />
      </label>
      {error && <p className="error">{error}</p>}
      <button className="btn-primary" disabled={!definitionId || mutation.isPending}>
        Agregar
      </button>
    </form>
  );
}

export default function SettingsPage() {
  const { user, logout } = useAuth();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);

  const { data: methods } = useQuery({
    queryKey: ['payment-methods'],
    queryFn: () => api<PaymentMethod[]>('/payment-methods'),
  });
  const { data: definitions } = useQuery({
    queryKey: ['catalog', 'definitions'],
    queryFn: () => api<PaymentMethodDefinition[]>('/catalog/payment-method-definitions'),
  });
  const { data: me } = useQuery({
    queryKey: ['me'],
    queryFn: () => api<{ household: { name: string; inviteCode: string; province: string | null } }>('/auth/me'),
  });

  const provinceMutation = useMutation({
    mutationFn: (province: string | null) =>
      api('/household', { method: 'PATCH', body: JSON.stringify({ province }) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['me'] });
      void queryClient.invalidateQueries({ queryKey: ['promotions'] });
    },
  });

  const removeMethod = async (id: string) => {
    if (!confirm('¿Eliminar este medio de pago?')) return;
    try {
      await api(`/payment-methods/${id}`, { method: 'DELETE' });
      void queryClient.invalidateQueries({ queryKey: ['payment-methods'] });
    } catch (err) {
      alert(err instanceof Error ? err.message : 'No se pudo eliminar');
    }
  };

  return (
    <div className="page">
      <header className="page-header">
        <h1>Ajustes</h1>
      </header>

      <section className="card">
        <h2>Hogar</h2>
        <p>
          <strong>{me?.household.name}</strong>
        </p>
        {me && (
          <p className="hint">
            Código de invitación para tu pareja: <code>{me.household.inviteCode}</code>
          </p>
        )}
        <label>
          Provincia (para filtrar promos)
          <select
            value={me?.household.province ?? ''}
            onChange={(e) => provinceMutation.mutate(e.target.value || null)}
            disabled={provinceMutation.isPending}
          >
            <option value="">Sin filtro (ver todo el país)</option>
            {ARGENTINE_PROVINCES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <p className="hint">Sesión: {user?.email}</p>
        <button className="btn-link" onClick={logout}>
          Cerrar sesión
        </button>
      </section>

      <section className="card">
        <div className="row-between">
          <h2>Medios de pago</h2>
          <button className="icon-btn" onClick={() => setShowForm(!showForm)}>
            {showForm ? '✕' : '＋'}
          </button>
        </div>
        {showForm && definitions && <AddMethodForm definitions={definitions} onDone={() => setShowForm(false)} />}
        {methods?.map((m) => (
          <div key={m.id} className="list-row">
            <div>
              <strong>{m.nickname ?? m.definition.name}</strong>
              <small>
                {' '}
                {m.definition.name}
                {m.lastFour ? ` ···${m.lastFour}` : ''}
                {m.closingDay ? ` · cierre ${m.closingDay}, vto ${m.dueDay}` : ''}
              </small>
            </div>
            <button className="btn-link" onClick={() => removeMethod(m.id)}>
              Eliminar
            </button>
          </div>
        ))}
        {methods && methods.length === 0 && <p className="hint">Agregá tus tarjetas y billeteras del catálogo.</p>}
      </section>
    </div>
  );
}
