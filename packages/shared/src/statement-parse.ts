/** Normalized line from a credit-card statement PDF (client-parsed). */
export type ParsedStatementLine = {
  date: string; // YYYY-MM-DD
  store: string;
  amount: number;
  currency: 'ARS' | 'USD';
  installment?: { current: number; total: number };
  /** Bank bonificación / reintegro applied to this consumo (positive number). */
  discountAmount?: number;
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
  /bonif\.?\s?/i,
  /saldo\s+anterior/i,
  /saldo\s+actual/i,
  /cuotas\s+a\s+vencer/i,
  /tasa\s+nominal/i,
  /\btna\b/i,
  /\btea\b/i,
  /cftea/i,
  /compra\s*\$/i,
  /l[ií]mite(\s+de\s+compra)?/i,
  /disponible/i,
  /vencimiento/i,
  /resumen\s+con/i,
  /\binteres/i,
  /\biva\b/i,
  /sus\s+pagos/i,
  /ajustes\s+realizados/i,
  /^\d+\s*cuotas(\s+de)?$/i,
  /tna\s+fija/i,
  /legales\s+y\s+avisos/i,
];

/** Lines that must never appear in import results (not even as omitidos). */
const DROP_COMPLETELY = [
  /^\d+\s*cuotas(\s+de)?$/i,
  /\d+\s+cuotas\s+de\s*\$/i,
  /^con\s+iva:/i,
  /^sin\s+iva:/i,
  /plan\s+v:/i,
  /cuotas\s+a\s+vencer/i,
  /l[ií]mites?/i,
  /octubre\/.*noviembre/i,
  /\$92\.500/i,
];

const JUNK_STORE_EXACT =
  /^(fecha|visa|resumen|tarjeta|cuotas|compra|limite|l[ií]mite|disponible|ars|usd|pesos|dolares|dólares|descripci[oó]n|nro\.?\s*cup[oó]n)$/i;

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

/** Map a catalog entity name (or free text) to a statement bank. */
export function bankFromEntityName(name: string | null | undefined): StatementBankSource {
  if (!name) return 'Unknown';
  const lower = name.toLowerCase();
  if (lower.includes('bbva') || lower.includes('franc')) return 'BBVA';
  if (lower.includes('santander')) return 'Santander';
  return 'Unknown';
}

export function isActionableLine(line: ParsedStatementLine): boolean {
  if (line.suggestedSkip) return false;
  if (line.currency !== 'ARS') return false;
  if (line.amount <= 0) return false;
  if (shouldDropCompletely(line.store) || shouldDropCompletely(line.raw)) return false;
  const key = normalizeStoreKey(line.store);
  if (key.length < 3) return false;
  if (JUNK_STORE_EXACT.test(line.store.trim())) return false;
  if (SKIP_PATTERNS.some((re) => re.test(line.store) || re.test(line.raw))) return false;
  // Placeholder date used when BBVA couldn't find a nearby date — treat as non-actionable.
  if (/^\d{4}-01-01$/.test(line.date) && !line.installment) return false;
  return true;
}

function looksLikeLimitContext(raw: string, amount: number): boolean {
  if (amount < 1_000_000) return false;
  return /l[ií]mite|disponible|compra\s*\$|compra\s+total/i.test(raw);
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

/**
 * Parse a single Argentine money token (e.g. "27.940,00", "-2.794,00", "1564.239,53-").
 * Rejects strings with extra digits/noise (page footers, cupón+amount glues).
 */
export function parseArgentineAmount(raw: string): number | null {
  let trimmed = raw.trim().replace(/\s/g, '');
  // Trailing minus (Santander payments) → leading
  if (trimmed.endsWith('-') && !trimmed.startsWith('-')) {
    trimmed = `-${trimmed.slice(0, -1)}`;
  }
  // One money token. Allow "1564.239,53" (missing leading thousand-dot) as well as "1.564.239,53".
  if (!/^-?\d{1,10}(?:\.\d{3})*,\d{2}$/.test(trimmed)) return null;
  const negative = trimmed.startsWith('-');
  const digits = trimmed.replace(/^-/, '');
  const normalized = digits.replace(/\./g, '').replace(',', '.');
  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;
  // Sanity: statement line amounts shouldn't be astronomical
  if (Math.abs(value) > 50_000_000) return null;
  return negative ? -Math.abs(value) : value;
}

/** Last money token on a line, e.g. "SHOP GALLERY 002430 27.940,00" → 27940 */
export function extractTrailingArgentineAmount(line: string): { amount: number; before: string } | null {
  const m = line
    .trim()
    .match(/^(.*?)(-?\d{1,10}(?:\.\d{3})*,\d{2}-?)\s*$/);
  if (!m) return null;
  const amount = parseArgentineAmount(m[2]!);
  if (amount == null) return null;
  return { amount, before: m[1]!.trim() };
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function shouldSkipLine(raw: string, amount: number | null): boolean {
  if (amount != null && amount <= 0) return true;
  if (amount != null && looksLikeLimitContext(raw, Math.abs(amount))) return true;
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

  // Line examples (pdfjs often uses single spaces):
  // 26 Mayo    06 000762 *  EQUUS                       C.02/06                       46.650,00
  // 26 Mayo   06 000762 *   EQUUS   C.02/06   46.650,00
  const rowRe =
    /^(?:(\d{2})\s+([A-Za-zÁÉÍÓÚáéíóúñÑ.]+)\s+)?(\d{2})\s+(\d{6})\s+([*FK])\s+(.+?)\s+(\S.*)$/;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
    if (!line) continue;

    // Carry year-month header like "26 Mayo" / "26 Junio" alone
    const headerOnly = line.match(/^(\d{2})\s+([A-Za-zÁÉÍÓÚáéíóúñÑ.]+)$/);
    if (headerOnly) {
      currentYearMonth = parseStatementDateParts(yearMonthHint, headerOnly[2]!, '01', year)?.slice(0, 7) ?? null;
      currentMonthToken = headerOnly[2]!;
      continue;
    }

    const m = line.match(rowRe);
    if (!m) {
      // Softer pattern without auth code — amount at end
      const soft = line.match(
        /^(?:(\d{2})\s+([A-Za-zÁÉÍÓÚáéíóúñÑ.]+)\s+)?(\d{2})\s+(.+?)\s+([\d.]+,\d{2}-?)$/,
      );
      if (!soft) continue;
      const monthToken = soft[2] ?? currentMonthToken;
      const dayToken = soft[3]!;
      const rest = soft[4]!;
      const amountRaw = soft[5]!;
      if (!monthToken) continue;
      // Skip soft matches that look like "SU PAGO" without auth (still handled via shouldSkip)
      pushSantanderLine({
        results,
        year,
        yearMonthHint: currentYearMonth ?? yearMonthHint,
        monthToken,
        dayToken,
        middle: rest,
        amountRaw,
        raw: line,
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
      raw: line,
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
 * BBVA resumen: consumos under "Consumos …".
 * With pdf.js x-sorted text, amount is usually on the description line:
 *   19-Ene-26
 *   TLM CARP C.06/06 003174 37.833,33
 * BONIF. lines become discounts on the matching consumo (not separate expenses).
 * Legal Plan V lines ("3 cuotas de $…") are dropped entirely.
 */
export function parseBbvaStatementText(text: string): ParsedStatementLine[] {
  const lines = text
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => l.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const results: ParsedStatementLine[] = [];
  results.push(...parseBbvaConsumosSections(lines));
  results.push(...parseBbvaImpuestosSection(lines));
  results.push(...parseBbvaBonificationLines(lines));

  return attachBbvaBonifications(dedupeByFingerprint(results));
}

function parseBbvaConsumosSections(lines: string[]): ParsedStatementLine[] {
  const results: ParsedStatementLine[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!/^consumos\b/i.test(line) || /total\s+consumos/i.test(line)) {
      i += 1;
      continue;
    }
    i += 1;
    while (i < lines.length && /^(fecha|descripci)/i.test(lines[i]!)) i += 1;

    while (i < lines.length) {
      const cur = lines[i]!;
      if (/^total\s+consumos/i.test(cur)) break;
      if (/^consumos\b/i.test(cur)) break;
      if (/^impuestos/i.test(cur) || /^legales/i.test(cur) || /^plan\s+v/i.test(cur)) break;

      if (shouldDropCompletely(cur)) {
        i += 1;
        continue;
      }

      const dateOnly = parseBbvaDateToken(cur);
      const dateInline = !dateOnly
        ? cur.match(/^(\d{1,2}[-\/][A-Za-zÁÉÍÓÚáéíóúñÑ.]+[-\/]\d{2,4})\s+(.+)$/)
        : null;

      let date: string | null = dateOnly;
      let descCandidate: string | null = null;
      let consumed = 1;

      if (dateOnly) {
        descCandidate = lines[i + 1] ?? null;
        consumed = 2;
      } else if (dateInline) {
        date = parseBbvaDateToken(dateInline[1]!);
        descCandidate = dateInline[2]!;
        consumed = 1;
      } else {
        i += 1;
        continue;
      }

      if (!date || !descCandidate) {
        i += 1;
        continue;
      }
      if (shouldDropCompletely(descCandidate)) {
        i += consumed;
        continue;
      }

      let amount: number | null = null;
      let desc = descCandidate;
      const trailing = extractTrailingArgentineAmount(descCandidate);
      if (trailing) {
        amount = trailing.amount;
        desc = trailing.before;
      } else {
        const next = lines[i + (dateOnly ? 2 : 1)];
        if (next) {
          const pure = parseArgentineAmount(next);
          if (pure != null) {
            amount = pure;
            consumed = dateOnly ? 3 : 2;
          }
        }
      }

      if (amount == null) {
        i += 1;
        continue;
      }

      const installment = parseInstallment(desc);
      const store = cleanBbvaStoreName(desc);
      const raw = dateOnly ? `${cur} ${descCandidate}` : cur;
      const isBonif = /bonif/i.test(desc) || /bonif/i.test(raw) || amount < 0;

      if (!store || normalizeStoreKey(store).length < 3) {
        i += consumed;
        continue;
      }
      if (shouldDropCompletely(store)) {
        i += consumed;
        continue;
      }

      const absAmount = Math.abs(amount);
      const fingerprint = fingerprintStatementLine({
        date,
        store,
        amount: absAmount,
        currency: 'ARS',
        installment,
      });

      results.push({
        date,
        store,
        amount: absAmount,
        currency: 'ARS',
        installment,
        raw,
        fingerprint,
        suggestedSkip: isBonif,
      });

      i += consumed;
    }
  }
  return results;
}

/**
 * Apply BONIF. CONSUMO / BONIF. PROMO X as discountAmount on matching consumo; drop bonif rows.
 */
export function attachBbvaBonifications(lines: ParsedStatementLine[]): ParsedStatementLine[] {
  const bonifsRaw = lines.filter((l) => /bonif/i.test(l.raw) || /bonif/i.test(l.store));
  const others = lines.filter((l) => !/bonif/i.test(l.raw) && !/bonif/i.test(l.store));

  // PDF often repeats the same bonif in summary + detalle — keep one per store+amount.
  const seenBonif = new Set<string>();
  const bonifs: ParsedStatementLine[] = [];
  for (const b of bonifsRaw) {
    const key = `${normalizeStoreKey(b.store)}|${b.amount.toFixed(2)}`;
    if (seenBonif.has(key)) continue;
    seenBonif.add(key);
    bonifs.push(b);
  }

  for (const bonif of bonifs) {
    const targetKey = normalizeStoreKey(
      bonif.store
        .replace(/^bonif\.?\s*/i, '')
        .replace(/^(consumo|promo)\s+/i, '')
        .trim(),
    );
    if (!targetKey) continue;

    let best: ParsedStatementLine | null = null;
    let bestScore = 0;
    for (const exp of others) {
      if (exp.suggestedSkip) continue;
      const expKey = normalizeStoreKey(exp.store);
      let score = 0;
      if (expKey === targetKey) score = 4;
      else if (expKey.includes(targetKey) || targetKey.includes(expKey)) score = 3;
      if (score === 0) continue;

      const already = exp.discountAmount ?? 0;
      if (already + bonif.amount > exp.amount * 0.45) continue;

      if (exp.date === bonif.date) score += 1;
      if (exp.amount > 0) {
        const ratio = bonif.amount / exp.amount;
        if (ratio >= 0.05 && ratio <= 0.4) score += 2;
      }
      if (already === 0) score += 3;

      if (score > bestScore) {
        bestScore = score;
        best = exp;
      }
    }
    if (best) {
      best.discountAmount = round2((best.discountAmount ?? 0) + bonif.amount);
    }
  }

  return others;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function parseBbvaImpuestosSection(lines: string[]): ParsedStatementLine[] {
  const results: ParsedStatementLine[] = [];
  let i = lines.findIndex((l) => /^impuestos,\s*cargos/i.test(l) || /^impuestos\b/i.test(l));
  if (i < 0) return results;
  i += 1;
  while (i < lines.length && /^(fecha|descripci)/i.test(lines[i]!)) i += 1;

  while (i < lines.length) {
    const cur = lines[i]!;
    if (/^saldo\s+actual/i.test(cur) || /^legales/i.test(cur) || /^plan\s+v/i.test(cur)) break;
    if (shouldDropCompletely(cur)) {
      i += 1;
      continue;
    }

    const dateOnly = parseBbvaDateToken(cur);
    const dateInline = !dateOnly
      ? cur.match(/^(\d{1,2}[-\/][A-Za-zÁÉÍÓÚáéíóúñÑ.]+[-\/]\d{2,4})\s+(.+)$/)
      : null;

    let date: string | null = dateOnly;
    let descCandidate: string | null = null;
    let consumed = 1;

    if (dateOnly) {
      descCandidate = lines[i + 1] ?? null;
      consumed = 2;
    } else if (dateInline) {
      date = parseBbvaDateToken(dateInline[1]!);
      descCandidate = dateInline[2]!;
      consumed = 1;
    } else {
      i += 1;
      continue;
    }

    if (!date || !descCandidate) {
      i += 1;
      continue;
    }

    let amount: number | null = null;
    let desc = descCandidate.replace(/\$\s*$/, '').trim();
    const trailing = extractTrailingArgentineAmount(descCandidate);
    if (trailing) {
      amount = trailing.amount;
      desc = trailing.before.replace(/\$\s*$/, '').trim();
    } else {
      const next = lines[i + (dateOnly ? 2 : 1)];
      if (next) {
        const pure = parseArgentineAmount(next);
        if (pure != null) {
          amount = pure;
          consumed = dateOnly ? 3 : 2;
        }
      }
    }

    if (amount == null || amount <= 0) {
      i += 1;
      continue;
    }

    const store = cleanBbvaStoreName(desc);
    if (!store || normalizeStoreKey(store).length < 3) {
      i += consumed;
      continue;
    }

    const fingerprint = fingerprintStatementLine({
      date,
      store,
      amount,
      currency: 'ARS',
    });
    results.push({
      date,
      store,
      amount,
      currency: 'ARS',
      raw: dateOnly ? `${cur} ${descCandidate}` : cur,
      fingerprint,
      suggestedSkip: false,
    });
    i += consumed;
  }
  return results;
}

/** BONIF lines outside Consumos (e.g. Sus pagos y ajustes / summary headers). */
function parseBbvaBonificationLines(lines: string[]): ParsedStatementLine[] {
  const results: ParsedStatementLine[] = [];
  let lastDate: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const cur = lines[i]!;
    if (shouldDropCompletely(cur)) continue;

    const dateOnly = parseBbvaDateToken(cur);
    if (dateOnly) {
      lastDate = dateOnly;
      const next = lines[i + 1];
      if (next && /bonif/i.test(next)) {
        const trailing = extractTrailingArgentineAmount(next);
        if (trailing && trailing.amount !== 0) {
          pushBbvaBonif(results, dateOnly, trailing.before, Math.abs(trailing.amount), `${cur} ${next}`);
          i += 1;
          continue;
        }
      }
      continue;
    }

    const inline = cur.match(/^(\d{1,2}[-\/][A-Za-zÁÉÍÓÚáéíóúñÑ.]+[-\/]\d{2,4})\s+(.+)$/);
    if (inline && /bonif/i.test(inline[2]!)) {
      const date = parseBbvaDateToken(inline[1]!);
      const trailing = extractTrailingArgentineAmount(inline[2]!);
      if (date && trailing && trailing.amount !== 0) {
        lastDate = date;
        pushBbvaBonif(results, date, trailing.before, Math.abs(trailing.amount), cur);
      }
      continue;
    }

    if (/bonif/i.test(cur) && lastDate) {
      const trailing = extractTrailingArgentineAmount(cur);
      if (trailing && trailing.amount !== 0) {
        pushBbvaBonif(results, lastDate, trailing.before, Math.abs(trailing.amount), cur);
      }
    }
  }

  return results;
}

function pushBbvaBonif(
  results: ParsedStatementLine[],
  date: string,
  desc: string,
  amount: number,
  raw: string,
): void {
  const store = cleanBbvaStoreName(desc);
  if (!store || normalizeStoreKey(store).length < 3) return;
  results.push({
    date,
    store,
    amount,
    currency: 'ARS',
    raw,
    fingerprint: fingerprintStatementLine({ date, store, amount, currency: 'ARS' }),
    suggestedSkip: true,
  });
}

/** Parse BBVA date tokens like 19-Ene-26 or 29-May-26. */
export function parseBbvaDateToken(token: string): string | null {
  const m = token
    .trim()
    .match(/^(\d{1,2})[-\/]([A-Za-zÁÉÍÓÚáéíóúñÑ.]+)[-\/](\d{2,4})$/);
  if (!m) return null;
  const day = Number(m[1]);
  const monthKey = m[2]!
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\./g, '');
  const month = MONTH_MAP[monthKey];
  let year = Number(m[3]);
  if (!month || !day || day > 31) return null;
  if (year < 100) year += 2000;
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

export function cleanBbvaStoreName(desc: string): string {
  let store = desc
    .replace(/C\.?\s*\d{1,2}\s*\/\s*\d{1,2}/i, '')
    .replace(/\b\d{6}\b/g, '') // cupón (exactly 6 digits)
    .replace(/\b\d{12,}\b/g, '') // long ids after CUOTA SOCIAL CAR
    .replace(/\$/g, '')
    .replace(/-?\d{1,10}(?:\.\d{3})*,\d{2}-?\s*$/g, '') // stray trailing amounts
    .replace(/\s+/g, ' ')
    .trim();
  // Trailing short cupón leftovers (1–5 digits), but keep years like 2026
  store = store.replace(/\s+\d{1,3}$/, '').trim();
  return store;
}

function shouldDropCompletely(text: string): boolean {
  const t = text.trim();
  if (DROP_COMPLETELY.some((re) => re.test(t))) return true;
  if (/^\d+\s*cuotas(\s+de)?/i.test(t)) return true;
  if (/con\s+iva:|sin\s+iva:/i.test(t)) return true;
  if (/l[ií]mite/i.test(t) && /compra|disponible|financi/i.test(t)) return true;
  // Month-range legales like "Octubre/26 Noviembre/26…"
  if (/(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiem|octubre|noviembre|diciembre)\/\d{2}/i.test(t)
    && (t.match(/\//g) ?? []).length >= 2) {
    return true;
  }
  return false;
}

function shouldSkipStoreName(store: string): boolean {
  const trimmed = store.trim();
  if (JUNK_STORE_EXACT.test(trimmed)) return true;
  if (normalizeStoreKey(trimmed).length < 3) return true;
  return SKIP_PATTERNS.some((re) => re.test(trimmed));
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
  const forced = bank && bank !== 'Unknown' ? bank : null;
  const detected = forced ?? detectStatementBank(text);

  const tryBank = (b: 'Santander' | 'BBVA') => {
    const lines = b === 'BBVA' ? parseBbvaStatementText(text) : parseSantanderStatementText(text);
    return { bank: b as StatementBankSource, lines };
  };

  if (detected === 'BBVA' || detected === 'Santander') {
    const primary = tryBank(detected);
    if (primary.lines.some(isActionableLine)) return primary;

    // Forced bank found nothing — try the other before giving up.
    if (forced) {
      const other = forced === 'BBVA' ? 'Santander' : 'BBVA';
      const secondary = tryBank(other);
      if (secondary.lines.some(isActionableLine)) return secondary;
    }
    return primary;
  }

  // Unknown: try Santander first (structured), then BBVA.
  const santander = parseSantanderStatementText(text);
  if (santander.some(isActionableLine)) {
    return { bank: 'Santander', lines: santander };
  }
  const bbva = parseBbvaStatementText(text);
  if (bbva.some(isActionableLine)) {
    return { bank: 'BBVA', lines: bbva };
  }
  return { bank: 'Unknown', lines: [...santander, ...bbva] };
}

