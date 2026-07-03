import { weeklyPromoGroupKey } from '@biko/shared';
import { fmtARS } from './api';
import { resolveStoreLogo, storeDisplayName } from './store-brands';
import type { DayRecommendation } from './types';

export type WeeklyPromo = DayRecommendation['promotions'][number];

export interface WeeklyPromoGroup {
  key: string;
  label: string;
  logo: string | null;
  promos: WeeklyPromo[];
}

export function groupWeeklyPromos(promos: WeeklyPromo[]): WeeklyPromoGroup[] {
  const byKey = new Map<string, WeeklyPromo[]>();
  for (const promo of promos) {
    const key = weeklyPromoGroupKey({
      store: promo.store,
      notes: promo.notes ?? null,
      entityName: promo.entityName,
    });
    const list = byKey.get(key) ?? [];
    list.push(promo);
    byKey.set(key, list);
  }

  return [...byKey.entries()].map(([key, items]) => {
    const sorted = [...items].sort((a, b) => b.discountPercentage - a.discountPercentage);
    const head = sorted[0]!;
    const label =
      head.store && !/consult|comercios adheridos|que acepten modo/i.test(head.store)
        ? storeDisplayName(head.store)
        : (head.notes ?? storeDisplayName(head.store));
    return {
      key,
      label,
      logo: resolveStoreLogo(head.store, head.imageUrl ?? null),
      promos: sorted,
    };
  });
}

export function WeeklyPromoVariant({ promo }: { promo: WeeklyPromo }) {
  const storeLabel = promo.store ? storeDisplayName(promo.store) : null;
  const title = storeLabel ?? promo.notes ?? 'Promo';
  const detailHints = promo.details?.filter(
    (d) => !/reintegro|cuotas sin inter[eé]s/i.test(d) || /compra m[ií]nima|adherid|presencial|online/i.test(d),
  );
  const subtitle = [
    storeLabel && promo.notes && promo.notes !== storeLabel ? promo.notes : null,
    promo.entityName,
    promo.discountCap ? `tope ${fmtARS.format(promo.discountCap)}` : null,
    promo.minPurchaseAmount ? `mín. ${fmtARS.format(promo.minPurchaseAmount)}` : null,
    promo.storesAdherents ? 'locales adheridos' : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="week-promo-variant">
      <div className="week-promo-variant-head">
        <strong className="week-promo-variant-pct">{promo.discountPercentage}%</strong>
        <span className="week-promo-variant-copy">
          <span className="week-promo-variant-title">{title}</span>
          <small>{subtitle}</small>
          {detailHints && detailHints.length > 0 && (
            <ul className="week-promo-detail-hints">
              {detailHints.slice(0, 4).map((detail) => (
                <li key={detail}>{detail}</li>
              ))}
            </ul>
          )}
        </span>
      </div>
      {promo.sourceUrl ? (
        <a className="week-promo-details-link" href={promo.sourceUrl} target="_blank" rel="noreferrer">
          Ver detalles en MODO
        </a>
      ) : null}
    </div>
  );
}

export function WeeklyPromoGroupCard({
  group,
  onHide,
}: {
  group: WeeklyPromoGroup;
  onHide?: (group: WeeklyPromoGroup) => void;
}) {
  const multi = group.promos.length > 1;
  const solo = group.promos[0]!;

  const hideButton = onHide ? (
    <button
      type="button"
      className="week-promo-hide-btn"
      onClick={() => onHide(group)}
      aria-label={`Ocultar ${group.label}`}
      title="Ocultar de Mi semana"
    >
      Ocultar
    </button>
  ) : null;

  if (!multi) {
    return (
      <div className="week-promo-group">
        <div className="week-promo-group-head">
          {group.logo ? (
            <img className="week-promo-logo" src={group.logo} alt="" loading="lazy" />
          ) : (
            <span className="week-promo-pct">{solo.discountPercentage}%</span>
          )}
          <WeeklyPromoVariant promo={solo} />
          {hideButton}
        </div>
      </div>
    );
  }

  return (
    <div className="week-promo-group multi">
      <div className="week-promo-group-head">
        {group.logo ? (
          <img className="week-promo-logo" src={group.logo} alt="" loading="lazy" />
        ) : (
          <span className="week-promo-pct">{solo.discountPercentage}%</span>
        )}
        <div className="week-promo-info">
          <strong>{group.label}</strong>
          <small className="week-promo-multi-hint">
            {group.promos.length} promos distintas — distinto banco, tope o condiciones
          </small>
        </div>
        {hideButton}
      </div>
      <div className="week-promo-variants">
        {group.promos.map((promo) => (
          <WeeklyPromoVariant key={promo.promotionId} promo={promo} />
        ))}
      </div>
    </div>
  );
}
