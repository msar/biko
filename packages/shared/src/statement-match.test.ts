import { describe, expect, it } from 'vitest';
import {
  amountsClose,
  findStatementMatchCandidates,
  storeSimilarity,
  type StatementMatchablePurchase,
} from './statement-match';

function purchase(
  overrides: Partial<StatementMatchablePurchase> & Pick<StatementMatchablePurchase, 'id' | 'store'>,
): StatementMatchablePurchase {
  return {
    description: null,
    purchaseDate: '2026-05-06T12:00:00.000Z',
    netAmount: 46650,
    paymentMethodId: 'pm1',
    installmentsCount: 1,
    statementFingerprint: null,
    installments: [{ number: 1, amount: 46650, dueDate: '2026-05-06T12:00:00.000Z' }],
    ...overrides,
  };
}

describe('statement fusion matching', () => {
  it('includes amount-close + date even with weak store name', () => {
    const candidates = findStatementMatchCandidates(
      {
        date: '2026-05-08',
        store: 'ZZZUNKNOWN',
        amount: 46600,
        fingerprint: 'x',
      },
      [
        purchase({
          id: 'p1',
          store: 'Something Else Entirely',
          netAmount: 46650,
          purchaseDate: '2026-05-06T12:00:00.000Z',
        }),
      ],
      'pm1',
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.purchaseId).toBe('p1');
    expect(candidates[0]?.matchReasons).toEqual(expect.arrayContaining(['amount', 'date']));
    expect(candidates[0]?.matchReasons).not.toContain('description');
  });

  it('includes partial description + date when amount is far', () => {
    const candidates = findStatementMatchCandidates(
      {
        date: '2026-05-07',
        store: 'EQUUS',
        amount: 999999,
        fingerprint: 'x',
      },
      [
        purchase({
          id: 'p1',
          store: 'Zapatería Centro',
          description: 'Compra en EQUUS cuota 2',
          netAmount: 200000,
          purchaseDate: '2026-05-06T12:00:00.000Z',
        }),
      ],
      'pm1',
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.matchReasons).toEqual(expect.arrayContaining(['description', 'date']));
    expect(candidates[0]?.matchReasons).not.toContain('amount');
  });

  it('excludes when date is outside ±5 days for purchase and due', () => {
    const candidates = findStatementMatchCandidates(
      {
        date: '2026-06-20',
        store: 'EQUUS',
        amount: 46650,
        fingerprint: 'x',
      },
      [
        purchase({
          id: 'p1',
          store: 'EQUUS',
          purchaseDate: '2026-05-01T12:00:00.000Z',
          installments: [{ number: 1, amount: 46650, dueDate: '2026-05-01T12:00:00.000Z' }],
        }),
      ],
      'pm1',
    );

    expect(candidates).toHaveLength(0);
  });

  it('matches cuota via due date within ±5 when purchase date is far', () => {
    const candidates = findStatementMatchCandidates(
      {
        date: '2026-05-13',
        store: 'EQUUS',
        amount: 46650,
        fingerprint: 'x',
        installment: { current: 2, total: 6 },
      },
      [
        purchase({
          id: 'p1',
          store: 'EQUUS',
          purchaseDate: '2026-01-10T12:00:00.000Z',
          netAmount: 279900,
          installmentsCount: 6,
          installments: [
            { number: 1, amount: 46650, dueDate: '2026-04-13T12:00:00.000Z' },
            { number: 2, amount: 46650, dueDate: '2026-05-13T12:00:00.000Z' },
          ],
        }),
      ],
      'pm1',
    );

    expect(candidates[0]?.purchaseId).toBe('p1');
    expect(candidates[0]?.installmentNumber).toBe(2);
    expect(candidates[0]?.matchReasons).toEqual(expect.arrayContaining(['amount', 'date']));
  });

  it('ranks amount hits above description-only hits', () => {
    const candidates = findStatementMatchCandidates(
      {
        date: '2026-05-06',
        store: 'EQUUS',
        amount: 46650,
        fingerprint: 'x',
      },
      [
        purchase({
          id: 'desc-only',
          store: 'Otro',
          description: 'EQUUS regalo',
          netAmount: 100,
          purchaseDate: '2026-05-06T12:00:00.000Z',
        }),
        purchase({
          id: 'amount-hit',
          store: 'EQUUS Shop',
          netAmount: 46650,
          purchaseDate: '2026-05-06T12:00:00.000Z',
        }),
      ],
      'pm1',
    );

    expect(candidates.map((c) => c.purchaseId)).toEqual(['amount-hit', 'desc-only']);
  });

  it('keeps store similarity and amount helpers', () => {
    expect(storeSimilarity('MERPAGO*FOODPATAGONIA', 'Food Patagonia')).toBeGreaterThan(0.3);
    expect(amountsClose(46650, 46600)).toBe(true);
  });
});
