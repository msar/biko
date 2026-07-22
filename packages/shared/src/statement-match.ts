import { normalizeStoreKey, type ParsedStatementLine } from './statement-parse';

export type StatementMatchReason = 'amount' | 'description' | 'date' | 'fingerprint';

export type StatementMatchCandidate = {
  purchaseId: string;
  store: string;
  description: string | null;
  purchaseDate: string;
  netAmount: number;
  installmentNumber: number | null;
  installmentAmount: number | null;
  installmentsCount: number;
  score: number;
  amountDelta: number;
  matchReasons: StatementMatchReason[];
};

export type StatementMatchablePurchase = {
  id: string;
  store: string;
  description: string | null;
  purchaseDate: string; // ISO
  netAmount: number;
  paymentMethodId: string;
  installmentsCount: number;
  statementFingerprint: string | null;
  installments: Array<{
    number: number;
    amount: number;
    dueDate: string; // ISO
  }>;
};

const TEXT_THRESHOLD = 0.35;

export function amountTolerance(amount: number): number {
  return Math.max(50, round2(Math.abs(amount) * 0.02));
}

export function amountsClose(a: number, b: number, tolerance?: number): boolean {
  const tol = tolerance ?? amountTolerance(Math.max(Math.abs(a), Math.abs(b)));
  return Math.abs(a - b) <= tol;
}

export function storeSimilarity(a: string, b: string): number {
  const ka = normalizeStoreKey(a);
  const kb = normalizeStoreKey(b);
  if (!ka || !kb) return 0;
  if (ka === kb) return 1;
  if (ka.includes(kb) || kb.includes(ka)) return 0.85;
  const ta = new Set(tokenize(ka));
  const tb = new Set(tokenize(kb));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter += 1;
  const union = ta.size + tb.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** Best similarity of statement store against purchase store and description. */
export function textSimilarity(lineStore: string, purchase: Pick<StatementMatchablePurchase, 'store' | 'description'>): number {
  const againstStore = storeSimilarity(lineStore, purchase.store);
  const againstDesc = purchase.description ? storeSimilarity(lineStore, purchase.description) : 0;
  return Math.max(againstStore, againstDesc);
}

function tokenize(key: string): string[] {
  const parts: string[] = [];
  let buf = '';
  for (const ch of key) {
    buf += ch;
    if (buf.length >= 4) {
      parts.push(buf.slice(0, 4));
    }
  }
  if (key.length >= 3) parts.push(key.slice(0, Math.min(8, key.length)));
  return [...new Set(parts)];
}

function daysBetween(aIso: string, bIso: string): number {
  const a = Date.parse(aIso.slice(0, 10));
  const b = Date.parse(bIso.slice(0, 10));
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 999;
  return Math.abs(a - b) / (1000 * 60 * 60 * 24);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function resolveAmountMatch(
  line: Pick<ParsedStatementLine, 'amount' | 'installment'>,
  purchase: StatementMatchablePurchase,
): {
  matchedInst: StatementMatchablePurchase['installments'][number] | null;
  amountDelta: number;
  amountScore: number;
  amountOk: boolean;
} {
  let matchedInst: StatementMatchablePurchase['installments'][number] | null = null;
  let amountDelta = Infinity;
  let amountScore = 0;

  if (line.installment) {
    const byNumber = purchase.installments.find((i) => i.number === line.installment!.current);
    const pool = byNumber ? [byNumber] : purchase.installments;
    for (const inst of pool) {
      const delta = Math.abs(inst.amount - line.amount);
      if (delta < amountDelta && amountsClose(inst.amount, line.amount)) {
        amountDelta = delta;
        matchedInst = inst;
        amountScore = 1 - Math.min(1, delta / Math.max(line.amount, 1));
      }
    }
    if (!matchedInst && amountsClose(purchase.netAmount, line.amount * (line.installment.total || 1))) {
      amountDelta = Math.abs(purchase.netAmount - line.amount * line.installment.total);
      amountScore = 0.7;
    }
  } else if (amountsClose(purchase.netAmount, line.amount)) {
    amountDelta = Math.abs(purchase.netAmount - line.amount);
    amountScore = 1 - Math.min(1, amountDelta / Math.max(line.amount, 1));
    matchedInst = purchase.installments[0] ?? null;
  } else {
    for (const inst of purchase.installments) {
      const delta = Math.abs(inst.amount - line.amount);
      if (delta < amountDelta && amountsClose(inst.amount, line.amount)) {
        amountDelta = delta;
        matchedInst = inst;
        amountScore = 0.75;
      }
    }
  }

  return {
    matchedInst,
    amountDelta: amountDelta === Infinity ? Math.abs(purchase.netAmount - line.amount) : amountDelta,
    amountScore,
    amountOk: amountScore > 0,
  };
}

/**
 * Best day delta vs purchase date and relevant cuota due date(s).
 * For cuota lines, prefer the installment matching `current` when present.
 */
export function bestDateDays(
  line: Pick<ParsedStatementLine, 'date' | 'installment'>,
  purchase: StatementMatchablePurchase,
  preferredInst?: StatementMatchablePurchase['installments'][number] | null,
): number {
  const targets: string[] = [purchase.purchaseDate];
  if (line.installment) {
    const byNumber =
      preferredInst ??
      purchase.installments.find((i) => i.number === line.installment!.current);
    if (byNumber) targets.push(byNumber.dueDate);
    else {
      for (const inst of purchase.installments) targets.push(inst.dueDate);
    }
  } else if (preferredInst) {
    targets.push(preferredInst.dueDate);
  } else {
    for (const inst of purchase.installments) targets.push(inst.dueDate);
  }

  let best = 999;
  for (const d of targets) {
    best = Math.min(best, daysBetween(line.date, d));
  }
  return best;
}

/**
 * Rank existing purchases that may correspond to a statement line.
 *
 * Eligible if date within ±window AND (amount close OR partial text match on store/description).
 * Cuotas use the same ±window against purchase date or that cuota's due date.
 */
export function findStatementMatchCandidates(
  line: Pick<ParsedStatementLine, 'date' | 'store' | 'amount' | 'installment' | 'fingerprint'>,
  purchases: StatementMatchablePurchase[],
  paymentMethodId: string,
  opts?: { dateWindowDays?: number; limit?: number },
): StatementMatchCandidate[] {
  const dateWindow = opts?.dateWindowDays ?? 5;
  const limit = opts?.limit ?? 10;
  const candidates: StatementMatchCandidate[] = [];

  for (const purchase of purchases) {
    if (purchase.paymentMethodId !== paymentMethodId) continue;

    if (purchase.statementFingerprint && purchase.statementFingerprint === line.fingerprint) {
      const inst = line.installment
        ? purchase.installments.find((i) => i.number === line.installment!.current)
        : purchase.installments[0];
      candidates.push({
        purchaseId: purchase.id,
        store: purchase.store,
        description: purchase.description,
        purchaseDate: purchase.purchaseDate.slice(0, 10),
        netAmount: purchase.netAmount,
        installmentNumber: inst?.number ?? null,
        installmentAmount: inst?.amount ?? null,
        installmentsCount: purchase.installmentsCount,
        score: 100,
        amountDelta: 0,
        matchReasons: ['fingerprint'],
      });
      continue;
    }

    const textScore = textSimilarity(line.store, purchase);
    const textOk = textScore >= TEXT_THRESHOLD;
    const amount = resolveAmountMatch(line, purchase);
    const dateDays = bestDateDays(line, purchase, amount.matchedInst);
    const dateOk = dateDays <= dateWindow;

    if (!dateOk) continue;
    if (!amount.amountOk && !textOk) continue;

    const dateScore = Math.max(0, 1 - dateDays / Math.max(dateWindow, 1));
    let score = textScore * 35 + amount.amountScore * 35 + dateScore * 25;
    if (line.installment && purchase.installmentsCount === line.installment.total) score += 5;
    if (line.installment && amount.matchedInst?.number === line.installment.current) score += 5;

    const matchReasons: StatementMatchReason[] = ['date'];
    if (amount.amountOk) matchReasons.push('amount');
    if (textOk) matchReasons.push('description');

    candidates.push({
      purchaseId: purchase.id,
      store: purchase.store,
      description: purchase.description,
      purchaseDate: purchase.purchaseDate.slice(0, 10),
      netAmount: purchase.netAmount,
      installmentNumber: amount.matchedInst?.number ?? null,
      installmentAmount: amount.matchedInst?.amount ?? null,
      installmentsCount: purchase.installmentsCount,
      score: round2(score),
      amountDelta: round2(amount.amountDelta),
      matchReasons,
    });
  }

  return candidates.sort((a, b) => b.score - a.score).slice(0, limit);
}

/**
 * Broader list for the Fusionar picker when strict matches are empty:
 * same card, purchase/due date within ±nearbyDays (default 45).
 */
export function findStatementPickerCandidates(
  line: Pick<ParsedStatementLine, 'date' | 'store' | 'amount' | 'installment' | 'fingerprint'>,
  purchases: StatementMatchablePurchase[],
  paymentMethodId: string,
  opts?: { nearbyDays?: number; limit?: number },
): StatementMatchCandidate[] {
  const nearbyDays = opts?.nearbyDays ?? 45;
  const limit = opts?.limit ?? 15;
  const out: StatementMatchCandidate[] = [];

  for (const purchase of purchases) {
    if (purchase.paymentMethodId !== paymentMethodId) continue;

    const amount = resolveAmountMatch(line, purchase);
    const dateDays = bestDateDays(line, purchase, amount.matchedInst);
    if (dateDays > nearbyDays) continue;

    const textScore = textSimilarity(line.store, purchase);
    const dateScore = Math.max(0, 1 - dateDays / nearbyDays);
    const score = textScore * 35 + amount.amountScore * 35 + dateScore * 25;

    const matchReasons: StatementMatchReason[] = [];
    if (dateDays <= 5) matchReasons.push('date');
    if (amount.amountOk) matchReasons.push('amount');
    if (textScore >= TEXT_THRESHOLD) matchReasons.push('description');

    out.push({
      purchaseId: purchase.id,
      store: purchase.store,
      description: purchase.description,
      purchaseDate: purchase.purchaseDate.slice(0, 10),
      netAmount: purchase.netAmount,
      installmentNumber: amount.matchedInst?.number ?? null,
      installmentAmount: amount.matchedInst?.amount ?? null,
      installmentsCount: purchase.installmentsCount,
      score: round2(score),
      amountDelta: round2(amount.amountDelta),
      matchReasons,
    });
  }

  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}
