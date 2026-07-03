import { describe, expect, it } from 'vitest';
import { CardNetwork, PaymentMethodType } from './enums';
import { entityNamesMatch, mapModoBankToCatalogName } from './entity-names';
import {
  HouseholdPaymentMethod,
  PromotionInput,
  getWeeklyRecommendations,
} from './promotion-recommender';
import { promotionMatchesHouseholdPaymentMethod, promoSponsorBanks } from './payment-method-matching';

const comafiVisa: HouseholdPaymentMethod = {
  id: 'pm-comafi',
  entityId: 'ent-comafi',
  entityName: 'Comafi',
  type: PaymentMethodType.CREDIT_CARD,
  network: CardNetwork.VISA,
};

const modoWallet: HouseholdPaymentMethod = {
  id: 'pm-modo',
  entityId: 'ent-modo',
  entityName: 'MODO',
  type: PaymentMethodType.WALLET,
  network: CardNetwork.NONE,
};

const santanderVisa: HouseholdPaymentMethod = {
  id: 'pm-sant',
  entityId: 'ent-santander',
  entityName: 'Santander',
  type: PaymentMethodType.CREDIT_CARD,
  network: CardNetwork.VISA,
};

function promo(overrides: Partial<PromotionInput>): PromotionInput {
  return {
    id: 'promo-x',
    entityId: 'ent-modo',
    entityName: 'MODO',
    store: 'ChangoMás',
    daysOfWeek: [],
    categoryIds: ['cat-super'],
    paymentMethodType: null,
    cardNetwork: null,
    discountPercentage: 20,
    discountCap: null,
    minPurchaseAmount: null,
    validFrom: null,
    validTo: null,
    active: true,
    ...overrides,
  };
}

describe('entityNamesMatch', () => {
  it('normalizes Banco Nación vs Nación', () => {
    expect(entityNamesMatch('Banco Nación', 'Nación')).toBe(true);
  });

  it('maps MODO bank names to catalog names', () => {
    expect(mapModoBankToCatalogName('Banco Comafi')).toBe('Comafi');
    expect(mapModoBankToCatalogName('Credicoop')).toBe('Credicoop');
  });
});

describe('promotionMatchesHouseholdPaymentMethod', () => {
  it('bank-exclusive MODO promo matches household with that bank card', () => {
    const bankPromo = promo({ entityId: 'ent-comafi', sponsorBank: 'Comafi' });
    expect(promotionMatchesHouseholdPaymentMethod(comafiVisa, bankPromo)).toBe(true);
    expect(promotionMatchesHouseholdPaymentMethod(santanderVisa, bankPromo)).toBe(false);
    expect(promotionMatchesHouseholdPaymentMethod(modoWallet, bankPromo)).toBe(false);
  });

  it('generic MODO promo matches MODO wallet only', () => {
    const generic = promo({ entityId: 'ent-modo', sponsorBank: null, sponsorBanks: [] });
    expect(promotionMatchesHouseholdPaymentMethod(modoWallet, generic)).toBe(true);
    expect(promotionMatchesHouseholdPaymentMethod(comafiVisa, generic)).toBe(false);
  });

  it('multi-bank promo matches any listed household bank', () => {
    const multiBank = promo({
      entityId: 'ent-modo',
      sponsorBank: null,
      sponsorBanks: ['Nación', 'BBVA', 'Santander'],
    });
    expect(promotionMatchesHouseholdPaymentMethod(santanderVisa, multiBank)).toBe(true);
    expect(promotionMatchesHouseholdPaymentMethod(comafiVisa, multiBank)).toBe(false);
    expect(promoSponsorBanks(multiBank)).toEqual(['Nación', 'BBVA', 'Santander']);
  });
});

describe('getWeeklyRecommendations sponsorBank', () => {
  it('does not show Comafi promos to households without Comafi', () => {
    const promos = [promo({ id: 'comafi', sponsorBank: 'Comafi', entityId: 'ent-comafi' })];
    const week = getWeeklyRecommendations([santanderVisa], promos);
    expect(week.every((d) => d.promotions.length === 0)).toBe(true);

    const withComafi = getWeeklyRecommendations([comafiVisa], promos);
    expect(withComafi.some((d) => d.promotions.some((p) => p.promotionId === 'comafi'))).toBe(true);
  });

  it('banksOnly hides generic MODO promos that only match a wallet', () => {
    const genericModo = promo({ id: 'modo-generic', entityId: 'ent-modo', sponsorBank: null });
    const withWallet = getWeeklyRecommendations([modoWallet, santanderVisa], [genericModo]);
    expect(withWallet.some((d) => d.promotions.some((p) => p.promotionId === 'modo-generic'))).toBe(true);

    const banksOnly = getWeeklyRecommendations([modoWallet, santanderVisa], [genericModo], new Date(), null, null, {
      banksOnly: true,
    });
    expect(banksOnly.every((d) => d.promotions.length === 0)).toBe(true);
  });

  it('banksOnly still shows bank-exclusive promos for matching cards', () => {
    const bankPromo = promo({ id: 'sant', sponsorBank: 'Santander', sponsorBanks: ['Santander'], entityId: 'ent-santander' });
    const week = getWeeklyRecommendations([santanderVisa], [bankPromo], new Date(), null, null, {
      banksOnly: true,
    });
    expect(week.some((d) => d.promotions.some((p) => p.promotionId === 'sant'))).toBe(true);
  });

  it('banksOnly shows multi-bank promos when household has an adherent bank', () => {
    const changomas = promo({
      id: 'chango-jul',
      entityId: 'ent-modo',
      sponsorBank: null,
      sponsorBanks: ['Nación', 'BBVA', 'Santander'],
      store: 'ChangoMás',
      daysOfWeek: ['MONDAY' as never],
      sourceUrl: 'https://www.modo.com.ar/promos/changomas-julio26',
    });
    const week = getWeeklyRecommendations([santanderVisa], [changomas], new Date(), null, null, {
      banksOnly: true,
    });
    const monday = week.find((d) => d.dayOfWeek === 'MONDAY')!;
    expect(monday.promotions.some((p) => p.promotionId === 'chango-jul')).toBe(true);
    expect(monday.promotions[0]?.entityName).toBe('Santander');
  });
});
