import { DISCOUNT_KIND_LABEL, formatPromotionBenefit, type DiscountKind, promotionMatchesProvince } from '@biko/shared';
import { useState } from 'react';
import { fmtARS, formatDays } from './api';
import { resolveStoreLogo, storeDisplayName } from './store-brands';
import type { Promotion } from './types';

export function discountDisplay(promo: Promotion): { headline: string; sublabel: string | null } {
  return formatPromotionBenefit({
    discountKind: promo.discountKind,
    discountLabel: promo.discountLabel,
    discountPercentage: Number(promo.discountPercentage),
  });
}

export function PromoCard({
  promo,
  onDeactivate,
  compact = false,
}: {
  promo: Promotion;
  onDeactivate?: () => void;
  compact?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const logo = resolveStoreLogo(promo.store, promo.imageUrl);
  const { headline, sublabel } = discountDisplay(promo);
  const kindLabel = DISCOUNT_KIND_LABEL[promo.discountKind as DiscountKind] ?? promo.discountKind;

  return (
    <div className={`card promo-card ${!promo.active ? 'inactive' : ''} ${compact ? 'promo-card-compact' : ''}`}>
      {logo ? (
        <img className="promo-logo" src={logo} alt="" loading="lazy" />
      ) : (
        <div className="promo-pct">
          <span>{headline}</span>
          {sublabel && <small>{sublabel}</small>}
        </div>
      )}
      <div className="promo-body">
        <div className="promo-head-row">
          <strong>
            {logo && <span className="promo-inline-pct">{headline}</span>}
            {promo.sponsorBanks.length > 1
              ? `Con ${promo.sponsorBanks.slice(0, 3).join(', ')}${promo.sponsorBanks.length > 3 ? '…' : ''}`
              : promo.sponsorBank
                ? `Exclusivo ${promo.sponsorBank}`
                : promo.entity.name}
            {promo.source === 'SCRAPED' && <span className="badge-scraped">{promo.externalSource ?? 'auto'}</span>}
          </strong>
          <span className={`badge-discount-kind kind-${promo.discountKind.toLowerCase()}`}>{kindLabel}</span>
        </div>
        <span className="promo-store-line">
          {storeDisplayName(promo.store)}
          {promo.storesAdherents && <span className="badge-adherents">Locales adheridos</span>}
          {' · '}
          {formatDays(promo.daysOfWeek)}
        </span>
        {promo.provinces.length > 0 && (
          <small className="promo-provinces">Solo en: {promo.provinces.join(', ')}</small>
        )}
        {promo.discountCap && <small>Tope mensual {fmtARS.format(Number(promo.discountCap))}</small>}
        {promo.notes && !compact && <small>{promo.notes}</small>}
        {promo.details.length > 0 && (
          <>
            <button type="button" className="btn-link promo-details-toggle" onClick={() => setExpanded(!expanded)}>
              {expanded ? 'Ocultar detalles' : 'Ver detalles'}
            </button>
            {expanded && (
              <ul className="promo-details-list">
                {promo.details.map((detail) => (
                  <li key={detail}>{detail}</li>
                ))}
                {promo.sourceUrl && (
                  <li>
                    <a href={promo.sourceUrl} target="_blank" rel="noreferrer">
                      Ver en MODO
                    </a>
                  </li>
                )}
              </ul>
            )}
          </>
        )}
      </div>
      {promo.active && onDeactivate && (
        <button className="btn-link" onClick={onDeactivate}>
          Desactivar
        </button>
      )}
    </div>
  );
}

export function filterPromosByLocation(promos: Promotion[], householdProvince: string | null): Promotion[] {
  if (!householdProvince) return promos;
  return promos.filter((p) => promotionMatchesProvince(p.provinces, householdProvince));
}
