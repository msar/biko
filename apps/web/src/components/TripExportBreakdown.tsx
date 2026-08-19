import { fmtMoney } from '../lib/api';
import {
  aggregateExportMemberTotals,
  totalExportPurchases,
  type TripExportCategoryMix,
} from '../lib/trip-export-ui';

interface TripExportBreakdownProps {
  netShare: number;
  categoryMix: TripExportCategoryMix[];
  /** Post-export reconciliation copy vs pre-export confirm copy */
  mode?: 'preview' | 'summary' | 'success';
}

export default function TripExportBreakdown({
  netShare,
  categoryMix,
  mode = 'preview',
}: TripExportBreakdownProps) {
  const memberTotals = aggregateExportMemberTotals(categoryMix);
  const purchaseCount = totalExportPurchases(categoryMix);

  return (
    <div className="trip-export-breakdown">
      {mode === 'summary' && (
        <p className="hint" style={{ marginTop: 0 }}>
          Esto es lo que quedó registrado en el hogar. Si varios pagaron la misma categoría, verás
          más de un gasto con el mismo nombre del viaje; la categoría aparece en cada fila.
        </p>
      )}
      {mode === 'success' && (
        <p className="hint" style={{ marginTop: 0 }}>
          Se crearon {purchaseCount} {purchaseCount === 1 ? 'gasto' : 'gastos'} en el hogar bajo
          Viajes ({fmtMoney(netShare)} en total).
        </p>
      )}
      {mode === 'preview' && (
        <p>
          Se va a registrar la parte del hogar ({fmtMoney(netShare)}) bajo Viajes, con lo que cada
          uno pagó y gastó.
          {purchaseCount > categoryMix.length && (
            <>
              {' '}
              <span className="hint">
                ({purchaseCount} gastos: cuando ambos pagaron una categoría, se crea uno por pagador)
              </span>
            </>
          )}
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

      <section className="trip-export-categories">
        <h3 className="trip-export-subtitle">Por categoría</h3>
        <ul className="settle-confirm-list">
          {categoryMix.map((c) => (
            <li key={c.category}>
              <strong>
                {c.seedCategoryName}: {fmtMoney(c.amount)}
              </strong>
              {c.percent > 0 ? ` (${c.percent}%)` : ''}
              {c.purchasesCount > 1 && (
                <span className="hint"> · {c.purchasesCount} gastos en Biko</span>
              )}
              {c.coveredByOthers && (
                <span className="hint">
                  {' '}
                  · nadie del hogar pagó esta categoría en el viaje (lo cubrió el grupo)
                </span>
              )}
              {c.members.length > 0 && (
                <ul className="settle-confirm-members">
                  {c.members.map((m) => (
                    <li key={m.userId}>
                      {m.name}: pagó {fmtMoney(m.paid)} · gastó {fmtMoney(m.share)}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
