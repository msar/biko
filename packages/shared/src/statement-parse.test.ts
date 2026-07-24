import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assemblePdfTextLines } from './pdf-text-assemble';
import {
  bankFromEntityName,
  cleanBbvaStoreName,
  detectStatementBank,
  fingerprintStatementLine,
  groupCardTaxLines,
  isActionableLine,
  isCardTaxLine,
  parseArgentineAmount,
  parseBbvaDateToken,
  parseBbvaStatementText,
  parseSantanderStatementText,
  parseStatementDateParts,
  parseStatementText,
} from './statement-parse';
import { formatMoneyExact } from './money';
import {
  amountsClose,
  findStatementMatchCandidates,
  storeSimilarity,
} from './statement-match';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const SANTANDER_FIXTURE = readFileSync(join(fixturesDir, 'santander-pdfjs-sample.txt'), 'utf8');
const BBVA_FIXTURE = readFileSync(join(fixturesDir, 'bbva-consumos.txt'), 'utf8');

describe('assemblePdfTextLines', () => {
  it('sorts items by x within the same y-bin', () => {
    const lines = assemblePdfTextLines(
      [
        { str: 'EQUUS', x: 200, y: 100 },
        { str: '06', x: 50, y: 100 },
        { str: '26 Mayo', x: 10, y: 100 },
        { str: '46.650,00', x: 400, y: 100 },
        { str: 'header', x: 10, y: 200 },
      ],
      { yBinSize: 1 },
    );
    expect(lines[0]).toBe('header'); // higher y first (top of page)
    expect(lines[1]).toBe('26 Mayo 06 EQUUS 46.650,00');
  });
});

describe('parseArgentineAmount', () => {
  it('parses dotted thousands', () => {
    expect(parseArgentineAmount('46.650,00')).toBe(46650);
    expect(parseArgentineAmount('1564.239,53-')).toBe(-1564239.53);
    expect(parseArgentineAmount('-2.794,00')).toBe(-2794);
  });

  it('rejects footer noise that is not a single money token', () => {
    expect(parseArgentineAmount('Sobre (140873) 1 de 1')).toBeNull();
    expect(parseArgentineAmount('1408731114,00')).toBeNull();
  });
});

describe('parseStatementDateParts', () => {
  it('maps Spanish months and wraps year for older months', () => {
    expect(parseStatementDateParts('2026-07', 'Mayo', '06', 2026)).toBe('2026-05-06');
    expect(parseStatementDateParts('2026-07', 'Setiem.', '15', 2026)).toBe('2025-09-15');
  });
});

describe('parseSantanderStatementText', () => {
  it('parses pdfjs-style single-spaced consumos and cuotas', () => {
    const lines = parseSantanderStatementText(SANTANDER_FIXTURE);
    const active = lines.filter(isActionableLine);

    expect(active.length).toBeGreaterThanOrEqual(8);

    const equus = active.find((l) => /EQUUS/i.test(l.store));
    expect(equus).toMatchObject({
      amount: 46650,
      installment: { current: 2, total: 6 },
    });
    expect(equus?.date).toBe('2026-05-06');

    const megatone = active.find((l) => /MEGATONE/i.test(l.store));
    expect(megatone?.installment).toEqual({ current: 10, total: 18 });

    expect(lines.some((l) => l.suggestedSkip && /SU PAGO/i.test(l.raw))).toBe(true);
  });

  it('parses USD subscriptions as actionable and skips SU PAGO EN USD', () => {
    const lines = parseSantanderStatementText(SANTANDER_FIXTURE);
    const active = lines.filter(isActionableLine);

    const spotify = active.find((l) => /spotify/i.test(l.store));
    expect(spotify).toMatchObject({ currency: 'USD', amount: 3.94 });
    expect(spotify?.suggestedSkip).toBe(false);

    const youtube = active.find((l) => /youtube/i.test(l.store));
    expect(youtube).toMatchObject({ currency: 'USD', amount: 4.71 });

    expect(lines.some((l) => /SU PAGO EN USD/i.test(l.raw) && l.suggestedSkip)).toBe(true);
    expect(active.some((l) => /SU PAGO EN USD/i.test(l.raw))).toBe(false);
  });

  it('detects Santander and respects hint', () => {
    expect(detectStatementBank(SANTANDER_FIXTURE)).toBe('Santander');
    expect(parseStatementText(SANTANDER_FIXTURE, 'Santander').bank).toBe('Santander');
    expect(parseStatementText(SANTANDER_FIXTURE, 'Santander').lines.filter(isActionableLine).length).toBeGreaterThan(
      5,
    );
  });
});

describe('groupCardTaxLines', () => {
  const TAX_SNIPPET = `
Santander Río
VISA
Cierre Ant.: 28 May 26 Vto. Ant.: 05 Jun 26
26 Mayo 06 000762 * EQUUS C.02/06 46.650,00
26 Julio 02 IMPUESTO DE SELLOS $ 19.084,39
02 IMPUESTO DE SELLOS P $ 297,80
02 IIBB PERCEP-CORD 3,00%( 6596,27) 197,88
02 IIBB PERCEP-CORD 3,00%( 7013,19) 210,39
26 Julio 02 IIBB PERCEP-CORD 3,00%( 6343,14) 190,29
02 IVA RG 4240 21%( 6596,27) 1.385,21
02 IVA RG 4240 21%( 7013,19) 1.472,76
02 DB.RG 5617 30% ( 19952,60 ) 5.985,78
`;

  it('groups sellos and IIBB into Impuestos tarjeta via parseStatementText', () => {
    const { lines } = parseStatementText(TAX_SNIPPET, 'Santander');
    const active = lines.filter(isActionableLine);

    const impuestos = active.find((l) => l.store === 'Impuestos tarjeta');
    expect(impuestos).toBeTruthy();
    expect(impuestos?.amount).toBe(19980.75);
    expect(impuestos?.description).toContain(`IMPUESTO DE SELLOS $: ${formatMoneyExact(19084.39, 'ARS')}`);
    expect(impuestos?.description).toContain(`IMPUESTO DE SELLOS P $: ${formatMoneyExact(297.8, 'ARS')}`);
    expect(impuestos?.description).toContain(
      `IIBB PERCEP-CORD 3,00%( 6596,27): ${formatMoneyExact(197.88, 'ARS')}`,
    );
    expect(impuestos?.description).toContain(
      `IIBB PERCEP-CORD 3,00%( 7013,19): ${formatMoneyExact(210.39, 'ARS')}`,
    );
    expect(impuestos?.description).toContain(
      `IIBB PERCEP-CORD 3,00%( 6343,14): ${formatMoneyExact(190.29, 'ARS')}`,
    );

    expect(active.some((l) => isCardTaxLine(l) && l.store !== 'Impuestos tarjeta')).toBe(false);
    expect(active.some((l) => /IVA RG/i.test(l.store))).toBe(false);
    const dbRg = active.find((l) => /DB\.?\s*RG/i.test(l.store));
    expect(dbRg?.amount).toBe(5985.78);
  });

  it('leaves non-tax lines untouched when grouping', () => {
    const ungrouped = parseSantanderStatementText(TAX_SNIPPET);
    const grouped = groupCardTaxLines(ungrouped);
    expect(grouped.filter((l) => /EQUUS/i.test(l.store))).toHaveLength(1);
    expect(grouped.filter((l) => l.store === 'Impuestos tarjeta')).toHaveLength(1);
    expect(ungrouped.filter(isCardTaxLine).length).toBeGreaterThanOrEqual(5);
  });
});

describe('bank hint and unknown fallback', () => {
  it('maps entity names to banks', () => {
    expect(bankFromEntityName('Santander')).toBe('Santander');
    expect(bankFromEntityName('BBVA')).toBe('BBVA');
  });

  it('never labels junk-only legales as BBVA', () => {
    const legales = `
Plan V: abonando el pago mínimo
3 cuotas de $ 124823,35
6 cuotas de $ 67564,07
Límites DE COMPRA $ 3.000.000,00
`;
    const parsed = parseStatementText(legales);
    expect(parsed.bank).toBe('Unknown');
    expect(parsed.lines.filter(isActionableLine)).toHaveLength(0);
  });
});

describe('parseBbvaStatementText', () => {
  it('parses 2-line consumos with trailing amounts, cupón strip and cuotas', () => {
    const lines = parseBbvaStatementText(BBVA_FIXTURE);
    const active = lines.filter(isActionableLine);

    const carp = active.find((l) => /TLM\s*CARP/i.test(l.store));
    expect(carp).toMatchObject({
      date: '2026-01-19',
      amount: 37833.33,
      installment: { current: 6, total: 6 },
    });
    expect(carp?.store).toBe('TLM CARP');

    const social = active.find((l) => /CUOTA SOCIAL CAR/i.test(l.store) && l.amount === 33350);
    expect(social?.store).toBe('CUOTA SOCIAL CAR');
    expect(social?.date).toBe('2026-05-29');
    expect(social?.discountAmount).toBe(6670);

    const social2 = active.find((l) => /CUOTA SOCIAL CAR/i.test(l.store) && l.amount === 44800);
    expect(social2?.discountAmount).toBe(8960);

    const shop = active.find((l) => /SHOP GALLERY/i.test(l.store));
    expect(shop).toMatchObject({ amount: 27940, discountAmount: 2794 });
    expect(shop?.store).toBe('SHOP GALLERY');

    expect(active.some((l) => /HOYTS/i.test(l.store))).toBe(true);
    expect(active.some((l) => /PRIMAVERA/i.test(l.store) && l.installment?.current === 1)).toBe(true);
    expect(active.some((l) => /IMPUESTO DE SELLOS/i.test(l.store) && l.amount === 5416.03)).toBe(true);

    // Bonifs are applied as discounts, not separate rows
    expect(lines.some((l) => /BONIF/i.test(l.store) || /BONIF/i.test(l.raw))).toBe(false);
    expect(active.some((l) => /BONIF/i.test(l.store))).toBe(false);
    expect(active.every((l) => l.amount < 1_000_000)).toBe(true);
  });

  it('drops Plan V legales and limits completely', () => {
    const lines = parseBbvaStatementText(BBVA_FIXTURE);
    expect(lines.some((l) => /cuotas de/i.test(l.store) || /cuotas de/i.test(l.raw))).toBe(false);
    expect(lines.some((l) => l.amount >= 1_000_000)).toBe(false);
    expect(lines.some((l) => /^3 cuotas$/i.test(l.store))).toBe(false);
    expect(lines.some((l) => /Octubre\/26/i.test(l.store))).toBe(false);
  });

  it('parses BBVA date tokens and cleans store names', () => {
    expect(parseBbvaDateToken('19-Ene-26')).toBe('2026-01-19');
    expect(parseBbvaDateToken('29-May-26')).toBe('2026-05-29');
    expect(cleanBbvaStoreName('CUOTA SOCIAL CAR 000000034964790 000001')).toBe('CUOTA SOCIAL CAR');
    expect(cleanBbvaStoreName('TLM CARP C.06/06 003174')).toBe('TLM CARP');
    expect(cleanBbvaStoreName('SHOP GALLERY 002430 27.940,00')).toBe('SHOP GALLERY');
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
          description: null,
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

    // Purchase date is far; cuota 2 due date is within ±5 of 2026-05-06? 05-13 vs 05-06 = 7 days → excluded.
    // Use due date closer to the line:
    expect(candidates.length).toBe(0);
  });

  it('matches cuota when due date is within window', () => {
    const candidates = findStatementMatchCandidates(
      {
        date: '2026-05-12',
        store: 'EQUUS',
        amount: 46600,
        fingerprint: 'x',
        installment: { current: 2, total: 6 },
      },
      [
        {
          id: 'p1',
          store: 'Equus',
          description: null,
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
    expect(candidates[0]?.matchReasons).toEqual(expect.arrayContaining(['amount', 'date', 'description']));
  });
});
