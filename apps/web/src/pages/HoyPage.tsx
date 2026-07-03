import { useQuery } from '@tanstack/react-query';
import { dayOfWeekFromDate } from '@biko/shared';
import { api, DAY_LABEL, fmtARS } from '../lib/api';
import type { DayRecommendation } from '../lib/types';

export default function HoyPage() {
  const { data: weekly } = useQuery({
    queryKey: ['promotions', 'weekly'],
    queryFn: () => api<DayRecommendation[]>('/promotions/weekly'),
  });

  const today = dayOfWeekFromDate(new Date());
  const todayRec = weekly?.find((d) => d.dayOfWeek === today);

  return (
    <div className="page">
      <header className="page-header">
        <h1>Hoy conviene…</h1>
      </header>
      <p className="hint">
        {new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })}
      </p>

      {todayRec && todayRec.promotions.length > 0 ? (
        todayRec.promotions.map((p) => (
          <div key={p.promotionId} className="card promo-card">
            <div className="promo-pct">{p.discountPercentage}%</div>
            <div className="promo-body">
              <strong>{p.entityName}</strong>
              <span>{p.store ?? 'Cualquier comercio'}</span>
              {p.discountCap && <small>Tope mensual {fmtARS.format(p.discountCap)}</small>}
            </div>
          </div>
        ))
      ) : (
        <p className="empty-state">
          {DAY_LABEL[today]}: sin promos para tus medios de pago. Cargá tus tarjetas en Ajustes o promos en la pestaña
          Promos.
        </p>
      )}
    </div>
  );
}
