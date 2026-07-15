import { describe, expect, it } from 'vitest';
import { visiblePurchaseWhere } from '../routes/expenses.js';
import { resolvePurchasePayer } from '../services/purchase-payer.js';

describe('visiblePurchaseWhere', () => {
  it('includes all HOUSEHOLD and only own PERSONAL', () => {
    expect(visiblePurchaseWhere('hh1', 'u1')).toEqual({
      householdId: 'hh1',
      OR: [{ scope: 'HOUSEHOLD' }, { scope: 'PERSONAL', userId: 'u1' }],
    });
  });
});

describe('resolvePurchasePayer', () => {
  const logger = { id: 'u1', name: 'Mariano' };
  const partner = { id: 'u2', name: 'Pareja' };

  it('uses paidBy snapshot when present', () => {
    expect(
      resolvePurchasePayer({
        paidBy: partner,
        paymentMethod: { owner: logger },
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

  it('falls back to who logged the expense', () => {
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
      paidBy: partner, // snapshot as create would set from PM owner
      paymentMethod: { owner: partner },
      user: logger,
    });
    expect(payer.id).toBe('u2');
  });
});
