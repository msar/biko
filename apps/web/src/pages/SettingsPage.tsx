import { ARGENTINE_PROVINCES } from '@biko/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useState } from 'react';
import { AddPaymentMethodsWizard, EditPaymentMethodForm } from '../components/PaymentMethodForm';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  groupMethodsByEntity,
  methodSubtitle,
  paymentMethodDisplayName,
} from '../lib/payment-method-catalog';
import type { PaymentMethod, PaymentMethodDefinition } from '../lib/types';

export default function SettingsPage() {
  const { user, logout } = useAuth();
  const queryClient = useQueryClient();
  const [panel, setPanel] = useState<'none' | 'add' | 'edit'>('none');
  const [editId, setEditId] = useState<string | null>(null);

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

  const closePanel = () => {
    setPanel('none');
    setEditId(null);
  };

  const removeMethod = async (id: string) => {
    if (!confirm('¿Eliminar este medio de pago?')) return;
    try {
      await api(`/payment-methods/${id}`, { method: 'DELETE' });
      void queryClient.invalidateQueries({ queryKey: ['payment-methods'] });
      if (editId === id) closePanel();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'No se pudo eliminar');
    }
  };

  const editMethod = methods?.find((m) => m.id === editId);
  const grouped = methods ? groupMethodsByEntity(methods) : [];

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

      {user?.isSuperUser && (
        <section className="card">
          <h2>Administración</h2>
          <p className="hint">Herramientas de mantenimiento del catálogo de promociones.</p>
          <Link to="/admin" className="btn-link">
            Sincronización de promos →
          </Link>
        </section>
      )}

      <section className="card">
        <div className="row-between">
          <h2>Medios de pago</h2>
          <button
            className="icon-btn"
            onClick={() => {
              if (panel === 'add') closePanel();
              else {
                setPanel('add');
                setEditId(null);
              }
            }}
          >
            {panel === 'add' ? '✕' : '＋'}
          </button>
        </div>

        {panel === 'add' && definitions && methods && (
          <AddPaymentMethodsWizard
            definitions={definitions}
            existingMethods={methods}
            onDone={closePanel}
            onCancel={closePanel}
          />
        )}

        {panel === 'edit' && editMethod && (
          <EditPaymentMethodForm method={editMethod} onDone={closePanel} onCancel={closePanel} />
        )}

        {grouped.map((group) => (
          <div key={group.entityId} className="payment-method-group">
            <h3 className="payment-method-group-title">{group.entityName}</h3>
            {group.items.map((m) => (
              <div key={m.id} className="list-row">
                <div>
                  <strong>{paymentMethodDisplayName(m)}</strong>
                  {methodSubtitle(m) && <small> {methodSubtitle(m)}</small>}
                </div>
                <div className="list-row-actions">
                  <button
                    className="btn-link"
                    onClick={() => {
                      setEditId(m.id);
                      setPanel('edit');
                    }}
                  >
                    Editar
                  </button>
                  <button className="btn-link" onClick={() => removeMethod(m.id)}>
                    Eliminar
                  </button>
                </div>
              </div>
            ))}
          </div>
        ))}

        {methods && methods.length === 0 && panel === 'none' && (
          <p className="hint">Agregá tus tarjetas y billeteras del catálogo.</p>
        )}
      </section>
    </div>
  );
}
