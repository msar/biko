import { describe, expect, it } from 'vitest';
import { parseSantanderStatementText } from '@biko/shared';
import { matchLinesAgainstPurchases } from '../services/statement-import.js';

describe('matchLinesAgainstPurchases', () => {
  it('suggests a merge for similar cuota lines', () => {
    const lines = parseSantanderStatementText(`
Vencimiento 13 Jul 26
26 Mayo    06 000762 *  EQUUS                       C.02/06                       46.650,00
`);
    const equus = lines.find((l) => /EQUUS/i.test(l.store));
    expect(equus).toBeTruthy();

    const matched = matchLinesAgainstPurchases(
      [equus!],
      [
        {
          id: 'p1',
          store: 'Equus',
          purchaseDate: '2026-04-20T12:00:00.000Z',
          netAmount: 279900,
          paymentMethodId: 'pm1',
          installmentsCount: 6,
          statementFingerprint: null,
          installments: [
            { number: 1, amount: 46650, dueDate: '2026-04-13T12:00:00.000Z' },
            { number: 2, amount: 46650, dueDate: '2026-05-13T12:00:00.000Z' },
          ],
        },
      ],
      'pm1',
    );

    expect(matched[0]?.topMatch?.purchaseId).toBe('p1');
    expect(matched[0]?.topMatch?.installmentNumber).toBe(2);
  });
});
