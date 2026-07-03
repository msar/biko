import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import type { PromotionSyncStatus } from '../lib/types';

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

export default function AdminPage() {
  return (
    <div className="page">
      <header className="page-header">
        <h1>Admin</h1>
        <Link to="/ajustes" className="icon-btn" aria-label="Volver a ajustes">
          ←
        </Link>
      </header>

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
      </section>
    </div>
  );
}
