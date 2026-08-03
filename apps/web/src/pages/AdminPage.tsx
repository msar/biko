import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import type { Category, PromotionSyncStatus } from '../lib/types';

function SyncPromoSourceButton({
  source,
  label,
  endpoint,
}: {
  source: string;
  label: string;
  endpoint: string;
}) {
  const queryClient = useQueryClient();
  const { data: statuses } = useQuery({
    queryKey: ['promotions', 'sync-status'],
    queryFn: () => api<PromotionSyncStatus[]>('/promotions/sync/status'),
  });
  const status = statuses?.find((s) => s.source === source);

  const sync = useMutation({
    mutationFn: () =>
      api<{ imported: number; updated: number; deactivated: number; cleared?: number }>(
        `${endpoint}?fresh=1`,
        { method: 'POST' },
      ),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['promotions'] });
      void queryClient.invalidateQueries({ queryKey: ['promotions', 'sync-status'] });
    },
  });

  return (
    <div className="sync-row">
      <button className="btn-link" onClick={() => sync.mutate()} disabled={sync.isPending}>
        {sync.isPending ? 'Sincronizando…' : `↻ Sincronizar ${label}`}
      </button>
      <small className="hint">
        {sync.isError && `Falló el sync (el sitio de ${label} pudo haber cambiado). `}
        {sync.isSuccess &&
          `Listo: ${sync.data.cleared != null ? `${sync.data.cleared} borradas, ` : ''}${sync.data.imported} nuevas, ${sync.data.updated} actualizadas, ${sync.data.deactivated} dadas de baja. `}
        {status?.lastRunAt && `Último sync: ${new Date(status.lastRunAt).toLocaleString('es-AR')}`}
        {status?.lastError && ` · último error: ${status.lastError}`}
      </small>
    </div>
  );
}

function CategoryAdminSection() {
  const queryClient = useQueryClient();
  const { data: categories } = useQuery({
    queryKey: ['categories'],
    queryFn: () => api<Category[]>('/categories'),
  });
  const globals = (categories ?? []).filter((c) => c.householdId === null);
  const [editing, setEditing] = useState<Category | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['categories'] });
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const remove = useMutation({
    mutationFn: (id: string) => api(`/categories/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'No se pudo borrar'),
  });

  return (
    <section className="card">
      <div className="row-between">
        <h2>Categorías globales</h2>
        <button type="button" className="btn-link" onClick={() => { setCreating(true); setEditing(null); }}>
          + Nueva
        </button>
      </div>
      <p className="hint">
        Editá nombre, ícono y color. Los grupos del dashboard (Comida, Restaurante, Auto…) se definen en código
        por nombre exacto.
      </p>
      {error && <p className="error">{error}</p>}

      {(creating || editing) && (
        <CategoryForm
          initial={editing}
          onCancel={() => {
            setCreating(false);
            setEditing(null);
          }}
          onDone={() => {
            setCreating(false);
            setEditing(null);
            invalidate();
          }}
        />
      )}

      <ul className="admin-category-list">
        {globals.map((cat) => (
          <li key={cat.id} className="admin-category-row">
            <span className="admin-category-swatch" style={{ background: cat.color ?? '#888' }} aria-hidden />
            <span className="admin-category-label">
              <span className="chip-icon">{cat.icon ?? '📦'}</span> {cat.name}
            </span>
            <div className="admin-category-actions">
              <button
                type="button"
                className="btn-link"
                onClick={() => {
                  setEditing(cat);
                  setCreating(false);
                  setError(null);
                }}
              >
                Editar
              </button>
              <button
                type="button"
                className="btn-link danger"
                disabled={remove.isPending}
                onClick={() => {
                  if (!window.confirm(`¿Borrar «${cat.name}»?`)) return;
                  remove.mutate(cat.id);
                }}
              >
                Borrar
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function CategoryForm({
  initial,
  onDone,
  onCancel,
}: {
  initial: Category | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [icon, setIcon] = useState(initial?.icon ?? '');
  const [color, setColor] = useState(initial?.color ?? '#888888');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      const body = {
        name: name.trim(),
        icon: icon.trim() || null,
        color: color.trim() || null,
      };
      if (initial) {
        return api<Category>(`/categories/${initial.id}`, {
          method: 'PUT',
          body: JSON.stringify(body),
        });
      }
      return api<Category>('/categories', {
        method: 'POST',
        body: JSON.stringify({ ...body, global: true }),
      });
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
    <form className="promo-form admin-category-form" onSubmit={onSubmit}>
      <div className="row-between">
        <h3>{initial ? 'Editar categoría' : 'Nueva categoría'}</h3>
        <button type="button" className="icon-btn" onClick={onCancel} aria-label="Cerrar">
          ✕
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      <label>
        Nombre
        <input value={name} onChange={(e) => setName(e.target.value)} required />
      </label>
      <div className="field-row">
        <label>
          Ícono
          <input value={icon} onChange={(e) => setIcon(e.target.value)} placeholder="🛵" maxLength={8} />
        </label>
        <label>
          Color
          <input type="color" value={color || '#888888'} onChange={(e) => setColor(e.target.value)} />
        </label>
      </div>
      <div className="row-between">
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

export default function AdminPage() {
  return (
    <div className="page">
      <header className="page-header">
        <h1>Admin</h1>
        <Link to="/ajustes" className="icon-btn" aria-label="Volver a ajustes">
          ←
        </Link>
      </header>

      <CategoryAdminSection />

      <section className="card">
        <h2>Sincronización de promociones</h2>
        <p className="hint">
          Importa promos desde los sitios oficiales. Cada sync borra las anteriores del mismo origen y vuelve a
          cargarlas.
        </p>
        <SyncPromoSourceButton source="MODO" label="MODO" endpoint="/promotions/sync/modo" />
        <SyncPromoSourceButton
          source="MERCADOPAGO"
          label="Mercado Pago"
          endpoint="/promotions/sync/mercadopago"
        />
        <SyncPromoSourceButton source="NARANJA_X" label="Naranja X" endpoint="/promotions/sync/naranjax" />
        <SyncPromoSourceButton source="SANTANDER" label="Santander" endpoint="/promotions/sync/santander" />
        <SyncPromoSourceButton source="GALICIA" label="Galicia" endpoint="/promotions/sync/galicia" />
      </section>
    </div>
  );
}
