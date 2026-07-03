import { describe, expect, it } from 'vitest';
import { CardNetwork, DayOfWeek, PaymentMethodType } from './enums';
import {
  HouseholdPaymentMethod,
  PromotionInput,
  getCategorySchedule,
  getWeeklyRecommendations,
  paymentMethodMatchesPromotion,
  promotionMatchesAnyCategory,
  promotionMatchesCategory,
  promotionMatchesDay,
} from './promotion-recommender';
import { findCandidatePromotions } from './promotion-suggester';

const santanderVisa: HouseholdPaymentMethod = {
  id: 'pm-1',
  entityId: 'ent-santander',
  entityName: 'Santander',
  type: PaymentMethodType.CREDIT_CARD,
  network: CardNetwork.VISA,
};

const modoWallet: HouseholdPaymentMethod = {
  id: 'pm-2',
  entityId: 'ent-modo',
  entityName: 'MODO',
  type: PaymentMethodType.WALLET,
  network: CardNetwork.NONE,
};

function promo(overrides: Partial<PromotionInput>): PromotionInput {
  return {
    id: 'promo-x',
    entityId: 'ent-santander',
    entityName: 'Santander',
    store: null,
    daysOfWeek: [],
    categoryIds: [],
    paymentMethodType: null,
    cardNetwork: null,
    discountPercentage: 20,
    discountCap: 15000,
    minPurchaseAmount: null,
    validFrom: null,
    validTo: null,
    active: true,
    ...overrides,
  };
}

describe('paymentMethodMatchesPromotion', () => {
  it('matches by entityId, not by name strings', () => {
    expect(paymentMethodMatchesPromotion(santanderVisa, promo({}))).toBe(true);
    expect(paymentMethodMatchesPromotion(modoWallet, promo({}))).toBe(false);
  });

  it('respects payment method type restriction', () => {
    expect(paymentMethodMatchesPromotion(santanderVisa, promo({ paymentMethodType: PaymentMethodType.DEBIT_CARD }))).toBe(false);
  });

  it('respects card network restriction (solo Visa)', () => {
    expect(paymentMethodMatchesPromotion(santanderVisa, promo({ cardNetwork: CardNetwork.VISA }))).toBe(true);
    expect(paymentMethodMatchesPromotion(santanderVisa, promo({ cardNetwork: CardNetwork.MASTERCARD }))).toBe(false);
  });
});

describe('promotionMatchesDay', () => {
  it('empty daysOfWeek matches every day', () => {
    expect(promotionMatchesDay(promo({}), DayOfWeek.TUESDAY)).toBe(true);
  });

  it('multi-day promo matches its days and no others', () => {
    const p = promo({ daysOfWeek: [DayOfWeek.MONDAY, DayOfWeek.WEDNESDAY] });
    expect(promotionMatchesDay(p, DayOfWeek.MONDAY)).toBe(true);
    expect(promotionMatchesDay(p, DayOfWeek.WEDNESDAY)).toBe(true);
    expect(promotionMatchesDay(p, DayOfWeek.TUESDAY)).toBe(false);
  });
});

describe('promotionMatchesCategory', () => {
  it('promo without categories matches any category', () => {
    expect(promotionMatchesCategory(promo({}), 'cat-fuel')).toBe(true);
  });

  it('promo with categories only matches those', () => {
    const p = promo({ categoryIds: ['cat-fuel'] });
    expect(promotionMatchesCategory(p, 'cat-fuel')).toBe(true);
    expect(promotionMatchesCategory(p, 'cat-super')).toBe(false);
  });

  it('null category filter matches everything', () => {
    expect(promotionMatchesCategory(promo({ categoryIds: ['cat-fuel'] }), null)).toBe(true);
  });
});

describe('getWeeklyRecommendations', () => {
  it('only surfaces promotions the household can actually use', () => {
    const promos = [
      promo({ id: 'sant-wed', daysOfWeek: [DayOfWeek.WEDNESDAY] }),
      promo({ id: 'naranja-sat', entityId: 'ent-naranja', entityName: 'Naranja X', daysOfWeek: [DayOfWeek.SATURDAY] }),
    ];
    const week = getWeeklyRecommendations([santanderVisa], promos);
    const wednesday = week.find((d) => d.dayOfWeek === DayOfWeek.WEDNESDAY)!;
    const saturday = week.find((d) => d.dayOfWeek === DayOfWeek.SATURDAY)!;
    expect(wednesday.promotions.map((p) => p.promotionId)).toEqual(['sant-wed']);
    expect(saturday.promotions).toHaveLength(0); // no tiene Naranja X
  });

  it('multi-day promotion appears on each of its days only', () => {
    const week = getWeeklyRecommendations(
      [santanderVisa],
      [promo({ id: 'multi', daysOfWeek: [DayOfWeek.MONDAY, DayOfWeek.WEDNESDAY] })],
    );
    const has = (day: DayOfWeek) =>
      week.find((d) => d.dayOfWeek === day)!.promotions.some((p) => p.promotionId === 'multi');
    expect(has(DayOfWeek.MONDAY)).toBe(true);
    expect(has(DayOfWeek.WEDNESDAY)).toBe(true);
    expect(has(DayOfWeek.TUESDAY)).toBe(false);
  });

  it('everyday promotions appear all 7 days', () => {
    const week = getWeeklyRecommendations([santanderVisa], [promo({ id: 'always' })]);
    expect(week.every((d) => d.promotions.some((p) => p.promotionId === 'always'))).toBe(true);
  });

  it('excludes expired promotions', () => {
    const week = getWeeklyRecommendations(
      [santanderVisa],
      [promo({ id: 'expired', validTo: '2020-01-01T00:00:00.000Z' })],
      new Date(2026, 6, 1),
    );
    expect(week.every((d) => d.promotions.length === 0)).toBe(true);
  });

  it('filters by category when provided', () => {
    const week = getWeeklyRecommendations(
      [santanderVisa],
      [promo({ id: 'fuel', categoryIds: ['cat-fuel'] }), promo({ id: 'super', categoryIds: ['cat-super'] })],
      new Date(2026, 6, 1),
      { mode: 'single', id: 'cat-fuel' },
    );
    const monday = week.find((d) => d.dayOfWeek === DayOfWeek.MONDAY)!;
    expect(monday.promotions.map((p) => p.promotionId)).toEqual(['fuel']);
  });

  it('filters essentials: includes super, excludes indumentaria and uncategorized', () => {
    const essentialIds = ['cat-super', 'cat-fuel'];
    const promos = [
      promo({ id: 'super', categoryIds: ['cat-super'], discountPercentage: 25 }),
      promo({ id: 'indumentaria', categoryIds: ['cat-clothes'], discountPercentage: 30 }),
      promo({ id: 'generic', categoryIds: [], discountPercentage: 40 }),
    ];
    const week = getWeeklyRecommendations(
      [santanderVisa],
      promos,
      new Date(2026, 6, 1),
      { mode: 'any', ids: essentialIds },
    );
    const monday = week.find((d) => d.dayOfWeek === DayOfWeek.MONDAY)!;
    expect(monday.promotions.map((p) => p.promotionId)).toEqual(['super']);
  });

  it('sorts promos by discount descending within each day', () => {
    const week = getWeeklyRecommendations(
      [santanderVisa],
      [
        promo({ id: 'low', discountPercentage: 10 }),
        promo({ id: 'high', discountPercentage: 30 }),
        promo({ id: 'mid', discountPercentage: 20 }),
      ],
    );
    const monday = week.find((d) => d.dayOfWeek === DayOfWeek.MONDAY)!;
    expect(monday.promotions.map((p) => p.promotionId)).toEqual(['high', 'mid', 'low']);
  });
});

describe('promotionMatchesAnyCategory', () => {
  it('requires at least one matching category when allowlist is set', () => {
    expect(promotionMatchesAnyCategory(promo({ categoryIds: ['cat-super'] }), ['cat-super', 'cat-fuel'])).toBe(true);
    expect(promotionMatchesAnyCategory(promo({ categoryIds: ['cat-clothes'] }), ['cat-super'])).toBe(false);
    expect(promotionMatchesAnyCategory(promo({ categoryIds: [] }), ['cat-super'])).toBe(false);
  });
});

describe('getCategorySchedule', () => {
  it('ranks days by best discount for the category ("cuando cargar nafta")', () => {
    const promos = [
      promo({ id: 'fuel-wed', categoryIds: ['cat-fuel'], daysOfWeek: [DayOfWeek.WEDNESDAY], discountPercentage: 20 }),
      promo({ id: 'fuel-sat', categoryIds: ['cat-fuel'], daysOfWeek: [DayOfWeek.SATURDAY], discountPercentage: 30 }),
      promo({ id: 'super-mon', categoryIds: ['cat-super'], daysOfWeek: [DayOfWeek.MONDAY], discountPercentage: 50 }),
    ];
    const schedule = getCategorySchedule('cat-fuel', [santanderVisa], promos);
    expect(schedule.map((d) => d.dayOfWeek)).toEqual([DayOfWeek.SATURDAY, DayOfWeek.WEDNESDAY]);
    expect(schedule[0]!.bestDiscount).toBe(30);
  });

  it('skips promos whose payment method the household lacks', () => {
    const promos = [
      promo({ id: 'naranja-fuel', entityId: 'ent-naranja', entityName: 'Naranja X', categoryIds: ['cat-fuel'] }),
    ];
    expect(getCategorySchedule('cat-fuel', [santanderVisa], promos)).toHaveLength(0);
  });
});

describe('findCandidatePromotions', () => {
  const wednesday = new Date(2026, 6, 1); // 2026-07-01 es miércoles

  it('filters by day of week', () => {
    const candidates = findCandidatePromotions({
      promotions: [
        promo({ id: 'wed', daysOfWeek: [DayOfWeek.WEDNESDAY] }),
        promo({ id: 'mon', daysOfWeek: [DayOfWeek.MONDAY] }),
      ],
      paymentMethod: santanderVisa,
      date: wednesday,
      store: null,
      grossAmount: 10000,
    });
    expect(candidates.map((c) => c.promotion.id)).toEqual(['wed']);
  });

  it('filters by category when provided', () => {
    const candidates = findCandidatePromotions({
      promotions: [promo({ id: 'fuel', categoryIds: ['cat-fuel'] }), promo({ id: 'super', categoryIds: ['cat-super'] })],
      paymentMethod: santanderVisa,
      date: wednesday,
      store: null,
      grossAmount: 10000,
      categoryId: 'cat-fuel',
    });
    expect(candidates.map((c) => c.promotion.id)).toEqual(['fuel']);
  });

  it('prefers store-specific promos and matches store case-insensitively', () => {
    const candidates = findCandidatePromotions({
      promotions: [
        promo({ id: 'generic', discountPercentage: 30 }),
        promo({ id: 'store', store: 'ChangoMás', discountPercentage: 20 }),
      ],
      paymentMethod: santanderVisa,
      date: wednesday,
      store: 'changomás',
      grossAmount: 10000,
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.promotion.id).toBe('store');
  });

  it('excludes generic promos when a store is specified', () => {
    const candidates = findCandidatePromotions({
      promotions: [promo({ id: 'generic', discountPercentage: 70, notes: 'Beneficio empleados MODO' })],
      paymentMethod: santanderVisa,
      date: wednesday,
      store: 'ChangoMás',
      grossAmount: 10000,
    });
    expect(candidates).toHaveLength(0);
  });

  it('excludes employee-only promos even without a store', () => {
    const candidates = findCandidatePromotions({
      promotions: [promo({ id: 'staff', discountPercentage: 70, notes: 'Beneficio empleados MODO' })],
      paymentMethod: santanderVisa,
      date: wednesday,
      store: null,
      grossAmount: 10000,
    });
    expect(candidates).toHaveLength(0);
  });

  it('matches store names ignoring accents', () => {
    const candidates = findCandidatePromotions({
      promotions: [promo({ id: 'store', store: 'ChangoMas', discountPercentage: 20 })],
      paymentMethod: santanderVisa,
      date: wednesday,
      store: 'ChangoMás',
      grossAmount: 10000,
    });
    expect(candidates.map((c) => c.promotion.id)).toEqual(['store']);
  });

  it('matches partial store names (Carnave in Granjas Carnave)', () => {
    const candidates = findCandidatePromotions({
      promotions: [promo({ id: 'carnave', store: 'Granjas Carnave', discountPercentage: 15 })],
      paymentMethod: santanderVisa,
      date: wednesday,
      store: 'Carnave',
      grossAmount: 10000,
    });
    expect(candidates.map((c) => c.promotion.id)).toEqual(['carnave']);
  });

  it('matches regional adherents promos when province and store are set', () => {
    const candidates = findCandidatePromotions({
      promotions: [
        promo({
          id: 'cordoba-supers',
          entityId: 'ent-modo',
          entityName: 'MODO',
          store: 'Supermercados de Córdoba',
          discountPercentage: 20,
          daysOfWeek: [DayOfWeek.FRIDAY],
          categoryIds: ['cat-super'],
          provinces: ['Córdoba'],
          storesAdherents: true,
          sponsorBanks: ['Santander'],
          notes: '20% de reintegro en Supermercados de Córdoba',
        }),
      ],
      paymentMethod: santanderVisa,
      date: new Date('2026-07-03T12:00:00'), // Friday
      store: 'Carnave',
      grossAmount: 10000,
      categoryId: 'cat-super',
      householdProvince: 'Córdoba',
    });
    expect(candidates.map((c) => c.promotion.id)).toEqual(['cordoba-supers']);
  });

  it('matches regional adherents promos regardless of expense category (Carnave as pollería)', () => {
    const candidates = findCandidatePromotions({
      promotions: [
        promo({
          id: 'cordoba-supers',
          entityId: 'ent-modo',
          entityName: 'MODO',
          store: 'Supermercados de Córdoba',
          discountPercentage: 20,
          daysOfWeek: [DayOfWeek.FRIDAY],
          categoryIds: ['cat-super'],
          provinces: ['Córdoba'],
          storesAdherents: true,
          sponsorBanks: ['Santander'],
          notes: '20% de reintegro en Supermercados de Córdoba',
        }),
      ],
      paymentMethod: santanderVisa,
      date: new Date('2026-07-03T12:00:00'),
      store: 'Carnave',
      grossAmount: 10000,
      categoryId: 'cat-poll',
      householdProvince: 'Córdoba',
    });
    expect(candidates.map((c) => c.promotion.id)).toEqual(['cordoba-supers']);
  });

  it('does not match regional group promo in wrong province', () => {
    const candidates = findCandidatePromotions({
      promotions: [
        promo({
          id: 'cordoba-supers',
          store: 'Supermercados de Córdoba',
          discountPercentage: 20,
          provinces: ['Córdoba'],
          storesAdherents: true,
          notes: '20% en Supermercados de Córdoba',
        }),
      ],
      paymentMethod: santanderVisa,
      date: wednesday,
      store: 'Carnave',
      grossAmount: 10000,
      householdProvince: 'Buenos Aires',
    });
    expect(candidates).toHaveLength(0);
  });

  it('drops store-specific promos when the store does not match', () => {
    const candidates = findCandidatePromotions({
      promotions: [promo({ id: 'store', store: 'Carrefour' })],
      paymentMethod: santanderVisa,
      date: wednesday,
      store: 'ChangoMás',
      grossAmount: 10000,
    });
    expect(candidates).toHaveLength(0);
  });

  it('respects minimum purchase amount', () => {
    const candidates = findCandidatePromotions({
      promotions: [promo({ id: 'min', minPurchaseAmount: 50000 })],
      paymentMethod: santanderVisa,
      date: wednesday,
      store: null,
      grossAmount: 10000,
    });
    expect(candidates).toHaveLength(0);
  });
});
