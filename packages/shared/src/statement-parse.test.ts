import { describe, expect, it } from 'vitest';
import {
  detectStatementBank,
  fingerprintStatementLine,
  parseArgentineAmount,
  parseSantanderStatementText,
  parseStatementDateParts,
  parseStatementText,
} from './statement-parse';
import {
  amountsClose,
  findStatementMatchCandidates,
  storeSimilarity,
} from './statement-match';

const SANTANDER_FIXTURE = `
Tarjeta 8009 Total Consumos de MARIANO JOSE SAPPIA
Vencimiento 13 Jul 26
26 Mayo    06 000762 *  EQUUS                       C.02/06                       46.650,00
           13 000217 *  FARMAONLINE                 C.02/03                       31.267,53
           14 510762 *  MERPAGO*TIMBERLANDARGENTI   C.02/06                       27.184,80
           29 511282 K  MERPAGO*CARNAVE                                           27.953,00
26 Junio   05           SU PAGO EN PESOS                                        1564.239,53-
           04 018194 K  MERPAGO*FOODPATAGONIA                                     74.200,00
           03 009452 *  ASSISTCARD                  C.01/03                       66.917,50
           26 000211 *  MEDITERRANEO                C.01/03                      291.218,34
25 Setiem. 15 008272 *  ELECTRONICA MEGATONE SRL    C.10/18                       47.499,88
`;

describe('parseArgentineAmount', () => {
  it('parses dotted thousands', () => {
    expect(parseArgentineAmount('46.650,00')).toBe(46650);
    expect(parseArgentineAmount('1564.239,53-')).toBe(-1564239.53);
    expect(parseArgentineAmount('291.218,34')).toBe(291218.34);
  });
});

describe('parseStatementDateParts', () => {
  it('maps Spanish months and wraps year for older months', () => {
    expect(parseStatementDateParts('2026-07', 'Mayo', '06', 2026)).toBe('2026-05-06');
    expect(parseStatementDateParts('2026-07', 'Setiem.', '15', 2026)).toBe('2025-09-15');
  });
});

describe('parseSantanderStatementText', () => {
  it('parses consumos, cuotas and skips payments', () => {
    const lines = parseSantanderStatementText(SANTANDER_FIXTURE);
    const active = lines.filter((l) => !l.suggestedSkip);
    const skipped = lines.filter((l) => l.suggestedSkip);

    expect(skipped.some((l) => /SU PAGO/i.test(l.raw))).toBe(true);

    const equus = active.find((l) => /EQUUS/i.test(l.store));
    expect(equus).toMatchObject({
      amount: 46650,
      installment: { current: 2, total: 6 },
    });
    expect(equus?.date).toBe('2026-05-06');

    const carnave = active.find((l) => /CARNAVE/i.test(l.store));
    expect(carnave?.installment).toBeUndefined();
    expect(carnave?.amount).toBe(27953);

    const megatone = active.find((l) => /MEGATONE/i.test(l.store));
    expect(megatone?.installment).toEqual({ current: 10, total: 18 });
    expect(megatone?.amount).toBe(47499.88);
  });

  it('detects Santander bank', () => {
    expect(detectStatementBank(SANTANDER_FIXTURE)).toBe('Santander');
    expect(parseStatementText(SANTANDER_FIXTURE).bank).toBe('Santander');
  });
});

describe('fingerprintStatementLine', () => {
  it('is stable for same logical line', () => {
    const a = fingerprintStatementLine({
      date: '2026-05-06',
      store: 'EQUUS',
      amount: 46650,
      currency: 'ARS',
      installment: { current: 2, total: 6 },
    });
    const b = fingerprintStatementLine({
      date: '2026-05-06',
      store: 'Equus',
      amount: 46650,
      currency: 'ARS',
      installment: { current: 2, total: 6 },
    });
    expect(a).toBe(b);
  });
});

describe('statement match', () => {
  it('matches similar store and fuzzy amount', () => {
    expect(storeSimilarity('MERPAGO*FOODPATAGONIA', 'Food Patagonia')).toBeGreaterThan(0.3);
    expect(amountsClose(46650, 46600)).toBe(true);
    expect(amountsClose(46650, 40000)).toBe(false);

    const candidates = findStatementMatchCandidates(
      {
        date: '2026-05-06',
        store: 'EQUUS',
        amount: 46600,
        fingerprint: 'x',
        installment: { current: 2, total: 6 },
      },
      [
        {
          id: 'p1',
          store: 'Equus',
          purchaseDate: '2026-04-20',
          netAmount: 279900,
          paymentMethodId: 'pm1',
          installmentsCount: 6,
          statementFingerprint: null,
          installments: [
            { number: 1, amount: 46650, dueDate: '2026-04-13' },
            { number: 2, amount: 46650, dueDate: '2026-05-13' },
          ],
        },
      ],
      'pm1',
    );

    expect(candidates[0]?.purchaseId).toBe('p1');
    expect(candidates[0]?.installmentNumber).toBe(2);
    expect(candidates[0]!.score).toBeGreaterThan(50);
  });

  it('rejects wrong payment method', () => {
    const candidates = findStatementMatchCandidates(
      {
        date: '2026-05-06',
        store: 'EQUUS',
        amount: 46650,
        fingerprint: 'x',
      },
      [
        {
          id: 'p1',
          store: 'EQUUS',
          purchaseDate: '2026-05-06',
          netAmount: 46650,
          paymentMethodId: 'other',
          installmentsCount: 1,
          statementFingerprint: null,
          installments: [{ number: 1, amount: 46650, dueDate: '2026-05-06' }],
        },
      ],
      'pm1',
    );
    expect(candidates).toHaveLength(0);
  });
});
