import { describe, expect, it } from 'vitest';
import { visiblePurchaseWhere } from '../routes/expenses.js';
import { resolvePaidByUserId, resolvePurchasePayer } from '../services/purchase-payer.js';

describe('visiblePurchaseWhere', () => {
  it('includes all HOUSEHOLD and only own PERSONAL', () => {
    expect(visiblePurchaseWhere('hh1', 'u1')).toEqual({
      householdId: 'hh1',
      OR: [{ scope: 'HOUSEHOLD' }, { scope: 'PERSONAL', userId: 'u1' }],
    });
  });
});

describe('resolvePurchasePayer', () => {
  const logger = { id: 'u1', name: 'Aylen' };
  const partner = { id: 'u2', name: 'Mariano' };

  it('uses paidBy snapshot when payment method has an owner', () => {
    expect(
      resolvePurchasePayer({
        paidBy: partner,
        paymentMethod: { owner: partner },
        user: logger,
      }),
    ).toEqual(partner);
  });

  it('falls back to payment method owner', () => {
    expect(
      resolvePurchasePayer({
        paidBy: null,
        paymentMethod: { owner: partner },
        user: logger,
      }),
    ).toEqual(partner);
  });

  it('unowned method uses who logged, ignoring stale paidBy from a later editor', () => {
    expect(
      resolvePurchasePayer({
        paidBy: partner,
        paymentMethod: { owner: null },
        user: logger,
      }),
    ).toEqual(logger);
  });

  it('unowned method with no snapshot uses logger', () => {
    expect(
      resolvePurchasePayer({
        paidBy: null,
        paymentMethod: { owner: null },
        user: logger,
      }),
    ).toEqual(logger);
  });

  it('partner payment method makes partner the payer even when logger is self', () => {
    const payer = resolvePurchasePayer({
      paidBy: partner,
      paymentMethod: { owner: partner },
      user: logger,
    });
    expect(payer.id).toBe('u2');
  });
});

describe('resolvePaidByUserId', () => {
  it('prefers payment method owner', () => {
    expect(
      resolvePaidByUserId({ paymentMethodOwnerUserId: 'owner-1', loggerUserId: 'logger-1' }),
    ).toBe('owner-1');
  });

  it('falls back to logger when method has no owner', () => {
    expect(
      resolvePaidByUserId({ paymentMethodOwnerUserId: null, loggerUserId: 'logger-1' }),
    ).toBe('logger-1');
  });
});
