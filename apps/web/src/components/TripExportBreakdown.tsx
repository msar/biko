import { Link } from 'react-router-dom';
import { fmtMoney } from '../lib/api';
import { aggregateExportMemberTotals, type TripExportCategoryMix, type TripExportMember } from '../lib/trip-export-ui';

interface TripExportBreakdownProps {
  netShare: number;
  categoryMix: TripExportCategoryMix[];
  members?: TripExportMember[] | null;
  tripId?: string;
  purchaseId?: string | null;
  /** Post-export reconciliation copy vs pre-export confirm copy */
  mode?: 'preview' | 'summary' | 'success';
}

export default function TripExportBreakdown({
  netShare,
  categoryMix,
  members,
  tripId,
  purchaseId,
  mode = 'preview',
}: TripExportBreakdownProps) {
  const memberTotals = aggregateExportMemberTotals(categoryMix, members);

  return (
    <div className="trip-export-breakdown">
      {mode === 'summary' && (
        <p className="hint" style={{ marginTop: 0 }}>
          Un gasto Viaje en el hogar ({fmtMoney(netShare)}) con lo que cada uno pagó y gastó. El
          detalle por categoría está en el viaje.
        </p>
      )}
      {mode === 'success' && (
        <p className="hint" style={{ marginTop: 0 }}>
          Se registró un gasto Viaje en el hogar por {fmtMoney(netShare)}.
        </p>
      )}
      {mode === 'preview' && (
        <p>
          Se va a registrar un solo gasto Viaje por la parte del hogar ({fmtMoney(netShare)}), con
          lo que cada uno pagó y gastó. El desglose por categoría queda en el viaje.
        </p>
      )}

      {memberTotals.length > 0 && (
        <section className="trip-export-totals">
          <h3 className="trip-export-subtitle">Total por integrante</h3>
          <ul className="settle-confirm-list">
            {memberTotals.map((m) => (
              <li key={m.userId}>
                <strong>{m.name}</strong>: pagó {fmtMoney(m.paid)} · gastó {fmtMoney(m.share)}
              </li>
            ))}
          </ul>
        </section>
      )}

      {mode === 'preview' && categoryMix.length > 0 && (
        <section className="trip-export-categories">
          <h3 className="trip-export-subtitle">Consumo por categoría (solo referencia)</h3>
          <ul className="settle-confirm-list">
            {categoryMix.map((c) => (
              <li key={c.category}>
                <strong>
                  {c.seedCategoryName}: {fmtMoney(c.amount)}
                </strong>
                {c.percent > 0 ? ` (${c.percent}%)` : ''}
                {c.coveredByOthers && (
                  <span className="hint">
                    {' '}
                    · nadie del hogar pagó esta categoría en el viaje (lo cubrió el grupo)
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {(mode === 'summary' || mode === 'success') && (tripId || purchaseId) && (
        <p className="trip-export-links" style={{ marginTop: 12 }}>
          {purchaseId && (
            <Link to={`/gastos/${purchaseId}`} className="btn-link">
              Ver gasto
            </Link>
          )}
          {purchaseId && tripId && ' · '}
          {tripId && (
            <Link to={`/viajes/${tripId}`} className="btn-link">
              Ver viaje
            </Link>
          )}
        </p>
      )}
    </div>
  );
}
