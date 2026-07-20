/** Normalized line from a credit-card statement PDF (client-parsed). */
export type ParsedStatementLine = {
  date: string; // YYYY-MM-DD
  store: string;
  amount: number;
  currency: 'ARS' | 'USD';
  installment?: { current: number; total: number };
  raw: string;
  fingerprint: string;
  /** True for payments, totals, Plan V, bonifications, etc. */
  suggestedSkip: boolean;
};

export type StatementBankSource = 'Santander' | 'BBVA' | 'Unknown';

const MONTH_MAP: Record<string, number> = {
  ene: 1,
  enero: 1,
  feb: 2,
  febrero: 2,
  mar: 3,
  marzo: 3,
  abr: 4,
  abril: 4,
  may: 5,
  mayo: 5,
  jun: 6,
  junio: 6,
  jul: 7,
  julio: 7,
  ago: 8,
  agosto: 8,
  set: 9,
  sep: 9,
  sept: 9,
  setiem: 9,
  setiembre: 9,
  septiembre: 9,
  oct: 10,
  octubre: 10,
  nov: 11,
  noviembre: 11,
  dic: 12,
  diciembre: 12,
};

const SKIP_PATTERNS = [
  /su\s+pago\s+en/i,
  /total\s+consumos/i,
  /total\s+de\s+cuotas/i,
  /pago\s+m[ií]nimo/i,
  /plan\s+v/i,
  /bonif\.?\s/i,
  /saldo\s+anterior/i,
  /cuotas\s+a\s+vencer/i,
  /tasa\s+nominal/i,
  /cftea/i,
  /compra\s+\$/i,
  /l[ií]mite\s+de\s+compra/i,
  /vencimiento/i,
  /resumen\s+con/i,
];

export function detectStatementBank(text: string): StatementBankSource {
  const lower = text.toLowerCase();
  if (lower.includes('bbva') || lower.includes('banco francés') || lower.includes('banco frances')) {
    return 'BBVA';
  }
  if (lower.includes('santander')) return 'Santander';
  // Heuristic: card total pattern used by Santander Visa resumenes.
  if (/tarjeta\s+\d{4}\s+total\s+consumos/i.test(text)) return 'Santander';
  if (/total\s+consumos\s+de\s+/i.test(text) && /visa\s+platinum/i.test(text)) {
    return 'BBVA';
  }
  return 'Unknown';
}

export function fingerprintStatementLine(input: {
  date: string;
  store: string;
  amount: number;
  currency: string;
  installment?: { current: number; total: number } | null;
}): string {
  const storeKey = normalizeStoreKey(input.store);
  const cuota = input.installment
    ? `C.${pad2(input.installment.current)}/${pad2(input.installment.total)}`
    : 'C.01/01';
  const amountKey = input.amount.toFixed(2);
  return `${input.date}|${storeKey}|${amountKey}|${input.currency}|${cuota}`;
}

export function normalizeStoreKey(store: string): string {
  return store
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toUpperCase()
    .replace(/MERPAGO\*/g, '')
    .replace(/[^A-Z0-9]+/g, '')
    .slice(0, 40);
}

export function parseArgentineAmount(raw: string): number | null {
  const cleaned = raw.replace(/\s/g, '').replace(/[^\d.,\-]/g, '');
  if (!cleaned || cleaned === '-' || cleaned === '.' || cleaned === ',') return null;
  const negative = cleaned.includes('-');
  const digits = cleaned.replace(/-/g, '');
  // 1.564.239,53 or 1564.239,53 or 47499,88
  let normalized: string;
  if (digits.includes(',')) {
    normalized = digits.replace(/\./g, '').replace(',', '.');
  } else if ((digits.match(/\./g) ?? []).length > 1) {
    normalized = digits.replace(/\./g, '');
  } else {
    normalized = digits;
  }
  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;
  return negative ? -Math.abs(value) : value;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function shouldSkipLine(raw: string, amount: number | null): boolean {
  if (amount != null && amount <= 0) return true;
  return SKIP_PATTERNS.some((re) => re.test(raw));
}

function parseInstallment(text: string): { current: number; total: number } | undefined {
  const m = text.match(/C\.?\s*(\d{1,2})\s*\/\s*(\d{1,2})/i);
  if (!m) return undefined;
  const current = Number(m[1]);
  const total = Number(m[2]);
  if (!current || !total || current > total) return undefined;
  return { current, total };
}

/**
 * Parse a date fragment like "26 Mayo", "26 Junio", "25 Setiem." plus day-of-month
 * from the transaction column ("06", "15"). Year is inferred from statementYear.
 */
export function parseStatementDateParts(
  yearMonthHint: string | null,
  monthToken: string,
  dayToken: string,
  statementYear: number,
): string | null {
  const day = Number(dayToken);
  if (!Number.isInteger(day) || day < 1 || day > 31) return null;
  const key = monthToken
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\./g, '')
    .trim();
  const month = MONTH_MAP[key];
  if (!month) return null;

  let year = statementYear;
  // If we have a closing hint like 2026-07, and month is after closing month in calendar
  // wrap is rare; prefer statement year. If month > statement month + 6, likely previous year
  // for "Setiem." purchases on a July statement → previous year.
  if (yearMonthHint) {
    const [yStr, mStr] = yearMonthHint.split('-');
    const stmtYear = Number(yStr);
    const stmtMonth = Number(mStr);
    if (stmtYear && stmtMonth) {
      year = stmtYear;
      if (month > stmtMonth + 1) year = stmtYear - 1;
    }
  }

  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function extractStatementYear(text: string): number {
  const m = text.match(/20\d{2}/);
  if (m) return Number(m[0]);
  return new Date().getFullYear();
}

function extractYearMonthHint(text: string): string | null {
  // "13 Jul 26" style vencimiento in metadata, or "07/26"
  const m = text.match(/vencimiento[^\d]*(\d{1,2})\s+([A-Za-z]+)\.?\s+(\d{2,4})/i);
  if (m) {
    const day = Number(m[1]);
    const monthToken = m[2];
    if (!monthToken) return null;
    const monthKey = monthToken
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .replace(/\./g, '');
    const month = MONTH_MAP[monthKey];
    let year = Number(m[3]);
    if (year < 100) year += 2000;
    if (month && day) return `${year}-${pad2(month)}`;
  }
  const m2 = text.match(/\b(20\d{2})[-\/](\d{2})\b/);
  if (m2) return `${m2[1]}-${m2[2]}`;
  return null;
}

/** Santander Visa fixed-width consumption lines. */
export function parseSantanderStatementText(text: string): ParsedStatementLine[] {
  const year = extractStatementYear(text);
  const yearMonthHint = extractYearMonthHint(text);
  const lines = text.split(/\r?\n/);
  const results: ParsedStatementLine[] = [];
  let currentYearMonth: string | null = null;
  let currentMonthToken: string | null = null;

  // Line examples:
  // 26 Mayo    06 000762 *  EQUUS                       C.02/06                       46.650,00
  //            13 000217 *  FARMAONLINE                 C.02/03                       31.267,53
  // 26 Junio   29 511282 K  MERPAGO*CARNAVE                                           27.953,00
  const rowRe =
    /^(?:(\d{2})\s+([A-Za-zÁÉÍÓÚáéíóúñÑ.]+)\s+)?(\d{2})\s+(\d{6})\s+([*FK])\s+(.+?)\s{2,}(.+)$/;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\u00a0/g, ' ').trim();
    if (!line) continue;

    // Carry year-month header like "26 Mayo" / "26 Junio" alone
    const headerOnly = line.trim().match(/^(\d{2})\s+([A-Za-zÁÉÍÓÚáéíóúñÑ.]+)\s*$/);
    if (headerOnly) {
      currentYearMonth = parseStatementDateParts(yearMonthHint, headerOnly[2]!, '01', year)?.slice(0, 7) ?? null;
      currentMonthToken = headerOnly[2]!;
      continue;
    }

    const m = line.match(rowRe);
    if (!m) {
      // Softer pattern without auth code
      const soft = line.match(
        /^(?:(\d{2})\s+([A-Za-zÁÉÍÓÚáéíóúñÑ.]+)\s+)?(\d{2})\s+(.+?)\s{2,}([\d.]+,\d{2}-?)\s*$/,
      );
      if (!soft) continue;
      const monthToken = soft[2] ?? currentMonthToken;
      const dayToken = soft[3]!;
      const rest = soft[4]!;
      const amountRaw = soft[5]!;
      if (!monthToken) continue;
      pushSantanderLine({
        results,
        year,
        yearMonthHint: currentYearMonth ?? yearMonthHint,
        monthToken,
        dayToken,
        middle: rest,
        amountRaw,
        raw: line.trim(),
      });
      if (soft[2]) {
        currentMonthToken = soft[2];
        currentYearMonth =
          parseStatementDateParts(yearMonthHint, soft[2], '01', year)?.slice(0, 7) ?? currentYearMonth;
      }
      continue;
    }

    const monthToken = m[2] ?? currentMonthToken;
    const dayToken = m[3]!;
    const middle = m[6]!;
    const amountTail = m[7]!;
    if (!monthToken) continue;

    if (m[2]) {
      currentMonthToken = m[2];
      currentYearMonth =
        parseStatementDateParts(yearMonthHint, m[2], '01', year)?.slice(0, 7) ?? currentYearMonth;
    }

    pushSantanderLine({
      results,
      year,
      yearMonthHint: currentYearMonth ?? yearMonthHint,
      monthToken,
      dayToken,
      middle,
      amountRaw: amountTail,
      raw: line.trim(),
    });
  }

  return dedupeByFingerprint(results);
}

function pushSantanderLine(args: {
  results: ParsedStatementLine[];
  year: number;
  yearMonthHint: string | null;
  monthToken: string;
  dayToken: string;
  middle: string;
  amountRaw: string;
  raw: string;
}): void {
  // Regex often splits store into middle and "C.nn/nn … amount" into amountRaw.
  const combined = `${args.middle} ${args.amountRaw}`;
  const amountMatch = combined.match(/([\d.]+,\d{2}-?)\s*$/);
  const amount = amountMatch ? parseArgentineAmount(amountMatch[1]!) : null;
  const date = parseStatementDateParts(args.yearMonthHint, args.monthToken, args.dayToken, args.year);
  if (!date) return;

  const installment = parseInstallment(combined);
  let store = combined
    .replace(/C\.?\s*\d{1,2}\s*\/\s*\d{1,2}/i, '')
    .replace(/\bUSD\b\s*[\d.,]*/gi, '')
    .replace(/[\d.]+,\d{2}-?\s*$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  store = store.replace(/^\d{6}\s+/, '').trim();
  if (!store) return;

  const currency: 'ARS' | 'USD' = /\bUSD\b/i.test(combined) ? 'USD' : 'ARS';
  const suggestedSkip = shouldSkipLine(args.raw, amount) || currency === 'USD';
  if (amount == null) return;

  const absAmount = Math.abs(amount);
  const fingerprint = fingerprintStatementLine({
    date,
    store,
    amount: absAmount,
    currency,
    installment,
  });

  args.results.push({
    date,
    store,
    amount: absAmount,
    currency,
    installment,
    raw: args.raw,
    fingerprint,
    suggestedSkip,
  });
}

/**
 * BBVA text is often fragmented. We scan for merchant + optional C.nn/nn + amount nearby.
 */
export function parseBbvaStatementText(text: string): ParsedStatementLine[] {
  const year = extractStatementYear(text);
  const yearMonthHint = extractYearMonthHint(text);
  const results: ParsedStatementLine[] = [];

  // Join PDF Tj fragments that may be one-per-line already
  const compact = text.replace(/\r/g, '\n');

  // Pattern: merchant name then optional cuota then amount on same or next tokens
  const lineRe =
    /([A-ZÁÉÍÓÚÑ0-9*][A-ZÁÉÍÓÚÑa-záéíóúñ0-9* .&\/-]{2,40}?)\s+(C\.\d{2}\/\d{2})?\s*\$?\s*([\d.]+,\d{2})/g;

  let match: RegExpExecArray | null;
  while ((match = lineRe.exec(compact)) !== null) {
    const storeRaw = match[1]!.trim();
    if (shouldSkipStoreName(storeRaw)) continue;
    const installment = match[2] ? parseInstallment(match[2]) : undefined;
    const amount = parseArgentineAmount(match[3]!);
    if (amount == null || amount <= 0) continue;

    // Try to find a nearby date (DD/MM or DD Mon) within 80 chars before
    const before = compact.slice(Math.max(0, match.index - 80), match.index);
    const date = findNearbyDate(before, year, yearMonthHint) ?? `${year}-01-01`;

    const store = storeRaw.replace(/\s{2,}/g, ' ').trim();
    const suggestedSkip = shouldSkipLine(match[0], amount) || shouldSkipStoreName(store);
    const fingerprint = fingerprintStatementLine({
      date,
      store,
      amount: Math.abs(amount),
      currency: 'ARS',
      installment,
    });

    results.push({
      date,
      store,
      amount: Math.abs(amount),
      currency: 'ARS',
      installment,
      raw: match[0].trim(),
      fingerprint,
      suggestedSkip,
    });
  }

  // Also try Santander-like rows if BBVA PDF extracted as continuous lines
  if (results.length === 0) {
    return parseSantanderStatementText(text);
  }

  return dedupeByFingerprint(results);
}

function shouldSkipStoreName(store: string): boolean {
  return SKIP_PATTERNS.some((re) => re.test(store)) || /^(fecha|visa|resumen|tarjeta|cuotas)$/i.test(store.trim());
}

function findNearbyDate(before: string, year: number, yearMonthHint: string | null): string | null {
  const dmy = before.match(/(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?/g);
  if (dmy && dmy.length) {
    const last = dmy[dmy.length - 1]!;
    const parts = last.match(/(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?/);
    if (parts) {
      const day = Number(parts[1]);
      const month = Number(parts[2]);
      let y = parts[3] ? Number(parts[3]) : year;
      if (y < 100) y += 2000;
      if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
        return `${y}-${pad2(month)}-${pad2(day)}`;
      }
    }
  }
  const named = before.match(/(\d{1,2})\s+([A-Za-zÁÉÍÓÚáéíóúñÑ.]+)/g);
  if (named && named.length) {
    const last = named[named.length - 1]!;
    const parts = last.match(/(\d{1,2})\s+([A-Za-zÁÉÍÓÚáéíóúñÑ.]+)/);
    if (parts) {
      return parseStatementDateParts(yearMonthHint, parts[2]!, parts[1]!, year);
    }
  }
  return null;
}

function dedupeByFingerprint(lines: ParsedStatementLine[]): ParsedStatementLine[] {
  const seen = new Set<string>();
  const out: ParsedStatementLine[] = [];
  for (const line of lines) {
    if (seen.has(line.fingerprint)) continue;
    seen.add(line.fingerprint);
    out.push(line);
  }
  return out;
}

export function parseStatementText(
  text: string,
  bank?: StatementBankSource,
): { bank: StatementBankSource; lines: ParsedStatementLine[] } {
  const detected = bank && bank !== 'Unknown' ? bank : detectStatementBank(text);
  if (detected === 'BBVA') {
    return { bank: detected, lines: parseBbvaStatementText(text) };
  }
  if (detected === 'Santander') {
    return { bank: detected, lines: parseSantanderStatementText(text) };
  }
  // Try Santander first (more structured), fall back to BBVA heuristics
  const santander = parseSantanderStatementText(text);
  if (santander.filter((l) => !l.suggestedSkip).length > 0) {
    return { bank: 'Santander', lines: santander };
  }
  return { bank: 'BBVA', lines: parseBbvaStatementText(text) };
}
