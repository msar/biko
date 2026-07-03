import { formatPromotionBenefit } from '@biko/shared';
import { useState } from 'react';
import { fmtARS, formatDays } from '../lib/api';
import { promoDetailsLinkLabel } from '../lib/promo-source-label';
import { storeDisplayName } from '../lib/store-brands';
import type { Suggestion } from '../lib/types';

export type SuggestionPromotion = Suggestion['promotion'];

export function suggestionBenefitText(promo: SuggestionPromotion): string {
  const { headline, sublabel } = formatPromotionBenefit(promo);
  const entity = promo.sponsorBank ? `${promo.sponsorBank} vía ${promo.entityName}` : promo.entityName;
  const storePart = promo.store ? ` en ${storeDisplayName(promo.store)}` : '';
  return sublabel ? `${headline} ${sublabel} · ${entity}${storePart}` : `${headline} ${entity}${storePart}`;
}

interface ExpenseSuggestionPromoProps {
  paymentMethodName: string;
  suggestion: Suggestion;
  selected?: boolean;
  showUseButton?: boolean;
  onUsePaymentMethod?: () => void;
}

export default function ExpenseSuggestionPromo({
  paymentMethodName,
  suggestion,
  selected = false,
  showUseButton = false,
  onUsePaymentMethod,
}: ExpenseSuggestionPromoProps) {
  const [expanded, setExpanded] = useState(false);
  const promo = suggestion.promotion as SuggestionPromotion;
  const { headline, sublabel } = formatPromotionBenefit(promo);
  const hasDetails =
    Boolean(promo.notes) ||
    (promo.details?.length ?? 0) > 0 ||
    Boolean(promo.sourceUrl) ||
    (promo.daysOfWeek?.length ?? 0) > 0 ||
    promo.minPurchaseAmount != null ||
    promo.discountCap != null;

  return (
    <div className={`reco-card ${selected ? 'reco-selected' : ''}`}>
      <div className="reco-head">✨ Promo recomendada</div>
      <div className="reco-body">
        <strong>{paymentMethodName}</strong>
        <span className="reco-benefit">
          <strong>{headline}</strong>
          {sublabel && <> {sublabel}</>}
          {' · '}
          {promo.sponsorBank ? `${promo.sponsorBank} vía ${promo.entityName}` : promo.entityName}
          {promo.store && <> en {storeDisplayName(promo.store)}</>}
        </span>
        {suggestion.estimatedDiscount != null && suggestion.estimatedNet != null && (
          <span className="reco-math">
            Ahorrás <strong>{fmtARS.format(suggestion.estimatedDiscount)}</strong> — pagás{' '}
            {fmtARS.format(suggestion.estimatedNet)}
            {suggestion.remainingCap != null && (
              <small> (tope restante {fmtARS.format(suggestion.remainingCap)})</small>
            )}
          </span>
        )}
        {hasDetails && (
          <>
            <button type="button" className="btn-link promo-details-toggle" onClick={() => setExpanded(!expanded)}>
              {expanded ? 'Ocultar detalles' : 'Ver detalles de la promo'}
            </button>
            {expanded && (
              <ul className="promo-details-list reco-details">
                {promo.notes && <li>{promo.notes}</li>}
                {(promo.daysOfWeek?.length ?? 0) > 0 && <li>Válida: {formatDays(promo.daysOfWeek ?? [])}</li>}
                {promo.minPurchaseAmount != null && (
                  <li>Compra mínima {fmtARS.format(promo.minPurchaseAmount)}</li>
                )}
                {promo.discountCap != null && <li>Tope mensual {fmtARS.format(promo.discountCap)}</li>}
                {promo.storesAdherents && <li>Solo en locales adheridos</li>}
                {promo.details?.map((detail) => <li key={detail}>{detail}</li>)}
                {promo.sourceUrl && (
                  <li>
                    <a href={promo.sourceUrl} target="_blank" rel="noreferrer">
                      {promoDetailsLinkLabel(promo.sourceUrl)}
                    </a>
                  </li>
                )}
              </ul>
            )}
          </>
        )}
      </div>
      {showUseButton && onUsePaymentMethod && (
        <button type="button" className="btn-primary reco-use" onClick={onUsePaymentMethod}>
          Usar este medio de pago
        </button>
      )}
    </div>
  );
}
