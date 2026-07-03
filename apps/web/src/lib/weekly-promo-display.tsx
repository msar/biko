import { formatPromotionBenefit, weeklyPromoGroupKey, type DayOfWeek } from '@biko/shared';
import { useState } from 'react';
import { DAY_LABEL, fmtARS } from './api';
import { resolveStoreLogo, storeDisplayName } from './store-brands';
import type { DayRecommendation, Promotion } from './types';

export type WeeklyPromo = DayRecommendation['promotions'][number] & {
  active?: boolean;
};

export interface WeeklyPromoGroup {
  key: string;
  label: string;
  logo: string | null;
  promos: WeeklyPromo[];
}

const WEEKLY_PROMO_CAP = 5;

function promoBenefitBadge(promo: WeeklyPromo): string {
  const { headline } = formatPromotionBenefit({
    discountKind: promo.discountKind,
    discountLabel: promo.discountLabel,
    discountPercentage: promo.discountPercentage,
  });
  return headline;
}

export function promotionToWeeklyPromo(p: Promotion): WeeklyPromo {
  return {
    promotionId: p.id,
    entityId: p.entityId,
    entityName: p.sponsorBank ? `${p.sponsorBank} vía ${p.entity.name}` : p.entity.name,
    store: p.store,
    discountPercentage: Number(p.discountPercentage),
    discountCap: p.discountCap ? Number(p.discountCap) : null,
    matchedPaymentMethodId: '',
    discountKind: p.discountKind,
    discountLabel: p.discountLabel,
    imageUrl: p.imageUrl,
    storesAdherents: p.storesAdherents,
    notes: p.notes,
    sourceUrl: p.sourceUrl,
    minPurchaseAmount: p.minPurchaseAmount ? Number(p.minPurchaseAmount) : null,
    details: p.details,
    active: p.active,
  };
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

export function WeeklyPromoVariant({
  promo,
  onDeactivate,
}: {
  promo: WeeklyPromo;
  onDeactivate?: (promotionId: string) => void;
}) {
  const storeLabel = promo.store ? storeDisplayName(promo.store) : null;
  const title = storeLabel ?? promo.notes ?? 'Promo';
  const benefit = formatPromotionBenefit({
    discountKind: promo.discountKind,
    discountLabel: promo.discountLabel,
    discountPercentage: promo.discountPercentage,
  });
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
    <div className={`week-promo-variant ${promo.active === false ? 'inactive' : ''}`}>
      <div className="week-promo-variant-head">
        <strong className="week-promo-variant-pct">{benefit.headline}</strong>
        <span className="week-promo-variant-copy">
          <span className="week-promo-variant-title">{title}</span>
          <small>
            {benefit.sublabel && promo.discountKind && promo.discountKind !== 'PERCENTAGE_REFUND'
              ? `${benefit.sublabel} · ${subtitle}`
              : subtitle}
          </small>
          {detailHints && detailHints.length > 0 && (
            <ul className="week-promo-detail-hints">
              {detailHints.slice(0, 4).map((detail) => (
                <li key={detail}>{detail}</li>
              ))}
            </ul>
          )}
        </span>
        {onDeactivate && promo.active !== false && (
          <button type="button" className="week-promo-hide-btn" onClick={() => onDeactivate(promo.promotionId)}>
            Desactivar
          </button>
        )}
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
  onDeactivate,
}: {
  group: WeeklyPromoGroup;
  onHide?: (group: WeeklyPromoGroup) => void;
  onDeactivate?: (promotionId: string) => void;
}) {
  const multi = group.promos.length > 1;
  const solo = group.promos[0]!;
  const inactive = group.promos.every((p) => p.active === false);

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
      <div className={`week-promo-group ${inactive ? 'inactive' : ''}`}>
        <div className="week-promo-group-head">
          {group.logo ? (
            <img className="week-promo-logo" src={group.logo} alt="" loading="lazy" />
          ) : (
            <span className="week-promo-pct">{promoBenefitBadge(solo)}</span>
          )}
          <WeeklyPromoVariant promo={solo} onDeactivate={onDeactivate} />
          {hideButton}
        </div>
      </div>
    );
  }

  return (
    <div className={`week-promo-group multi ${inactive ? 'inactive' : ''}`}>
      <div className="week-promo-group-head">
        {group.logo ? (
          <img className="week-promo-logo" src={group.logo} alt="" loading="lazy" />
        ) : (
          <span className="week-promo-pct">{promoBenefitBadge(solo)}</span>
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
          <WeeklyPromoVariant key={promo.promotionId} promo={promo} onDeactivate={onDeactivate} />
        ))}
      </div>
    </div>
  );
}

export function WeeklyDayCard({
  day,
  onHideGroup,
  onDeactivate,
  cap = WEEKLY_PROMO_CAP,
}: {
  day: DayRecommendation;
  onHideGroup?: (group: WeeklyPromoGroup) => void;
  onDeactivate?: (promotionId: string) => void;
  cap?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const groups = groupWeeklyPromos(day.promotions);
  const visible = expanded ? groups : groups.slice(0, cap);
  const hiddenCount = groups.length - cap;

  return (
    <div className="week-day card">
      <h3>{DAY_LABEL[day.dayOfWeek]}</h3>
      {visible.map((group) => (
        <WeeklyPromoGroupCard
          key={group.key}
          group={group}
          onHide={onHideGroup}
          onDeactivate={onDeactivate}
        />
      ))}
      {!expanded && hiddenCount > 0 && (
        <button type="button" className="btn-link week-promo-more" onClick={() => setExpanded(true)}>
          Ver {hiddenCount} más
        </button>
      )}
    </div>
  );
}

export function TodayPromos({
  weekly,
  today,
  onHideGroup,
}: {
  weekly: DayRecommendation[] | undefined;
  today: DayOfWeek;
  onHideGroup?: (group: WeeklyPromoGroup) => void;
}) {
  const todayRec = weekly?.find((d) => d.dayOfWeek === today);
  const groups = todayRec ? groupWeeklyPromos(todayRec.promotions) : [];

  return (
    <div className="week-calendar">
      <p className="hint">
        {new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })}
      </p>
      {groups.length > 0 ? (
        <div className="week-day card">
          {groups.map((group) => (
            <WeeklyPromoGroupCard key={group.key} group={group} onHide={onHideGroup} />
          ))}
        </div>
      ) : (
        <p className="empty-state">
          {DAY_LABEL[today]}: sin promos para tus medios de pago. Cargá tus tarjetas en Ajustes o promos en la pestaña
          Todas.
        </p>
      )}
    </div>
  );
}
