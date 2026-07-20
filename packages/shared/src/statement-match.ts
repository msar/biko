import { normalizeStoreKey, type ParsedStatementLine } from './statement-parse';

export type StatementMatchCandidate = {
  purchaseId: string;
  store: string;
  purchaseDate: string;
  netAmount: number;
  installmentNumber: number | null;
  installmentAmount: number | null;
  installmentsCount: number;
  score: number;
  amountDelta: number;
};

export type StatementMatchablePurchase = {
  id: string;
  store: string;
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

function tokenize(key: string): string[] {
  // Split Camel / glued words into chunks of 3+
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

/**
 * Rank existing purchases that may correspond to a statement line.
 * For cuota lines, compares against installment amounts; otherwise netAmount.
 */
export function findStatementMatchCandidates(
  line: Pick<ParsedStatementLine, 'date' | 'store' | 'amount' | 'installment' | 'fingerprint'>,
  purchases: StatementMatchablePurchase[],
  paymentMethodId: string,
  opts?: { dateWindowDays?: number; limit?: number },
): StatementMatchCandidate[] {
  const dateWindow = opts?.dateWindowDays ?? 5;
  const limit = opts?.limit ?? 5;
  const candidates: StatementMatchCandidate[] = [];

  for (const purchase of purchases) {
    if (purchase.paymentMethodId !== paymentMethodId) continue;

    // Exact fingerprint already linked
    if (purchase.statementFingerprint && purchase.statementFingerprint === line.fingerprint) {
      const inst = line.installment
        ? purchase.installments.find((i) => i.number === line.installment!.current)
        : purchase.installments[0];
      candidates.push({
        purchaseId: purchase.id,
        store: purchase.store,
        purchaseDate: purchase.purchaseDate.slice(0, 10),
        netAmount: purchase.netAmount,
        installmentNumber: inst?.number ?? null,
        installmentAmount: inst?.amount ?? null,
        installmentsCount: purchase.installmentsCount,
        score: 100,
        amountDelta: 0,
      });
      continue;
    }

    const storeScore = storeSimilarity(line.store, purchase.store);
    if (storeScore < 0.35) continue;

    let matchedInst = null as StatementMatchablePurchase['installments'][number] | null;
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
      // Also allow matching full net when user logged full purchase without cuotas yet
      if (!matchedInst && amountsClose(purchase.netAmount, line.amount * (line.installment.total || 1))) {
        amountDelta = Math.abs(purchase.netAmount - line.amount * line.installment.total);
        amountScore = 0.7;
      }
      if (
        line.installment.total &&
        purchase.installmentsCount > 1 &&
        purchase.installmentsCount !== line.installment.total
      ) {
        // soft penalty applied later
      }
    } else {
      if (amountsClose(purchase.netAmount, line.amount)) {
        amountDelta = Math.abs(purchase.netAmount - line.amount);
        amountScore = 1 - Math.min(1, amountDelta / Math.max(line.amount, 1));
        matchedInst = purchase.installments[0] ?? null;
      } else {
        // Maybe they logged one cuota amount as full expense by mistake
        for (const inst of purchase.installments) {
          const delta = Math.abs(inst.amount - line.amount);
          if (delta < amountDelta && amountsClose(inst.amount, line.amount)) {
            amountDelta = delta;
            matchedInst = inst;
            amountScore = 0.75;
          }
        }
      }
    }

    if (amountScore <= 0) continue;

    const dateTargets = [
      purchase.purchaseDate,
      ...(matchedInst ? [matchedInst.dueDate] : purchase.installments.map((i) => i.dueDate)),
    ];
    let bestDateDays = 999;
    for (const d of dateTargets) {
      bestDateDays = Math.min(bestDateDays, daysBetween(line.date, d));
    }
    if (bestDateDays > dateWindow + 35 && line.installment) {
      // Cuotas: allow wider window across months — compare relative to installment due
      // already included; if still far, skip weak matches
      if (bestDateDays > 40) continue;
    } else if (bestDateDays > dateWindow && !line.installment) {
      continue;
    }

    const dateScore = Math.max(0, 1 - bestDateDays / 40);
    let score = storeScore * 40 + amountScore * 40 + dateScore * 20;
    if (line.installment && purchase.installmentsCount === line.installment.total) score += 5;
    if (line.installment && matchedInst?.number === line.installment.current) score += 5;

    candidates.push({
      purchaseId: purchase.id,
      store: purchase.store,
      purchaseDate: purchase.purchaseDate.slice(0, 10),
      netAmount: purchase.netAmount,
      installmentNumber: matchedInst?.number ?? null,
      installmentAmount: matchedInst?.amount ?? null,
      installmentsCount: purchase.installmentsCount,
      score: round2(score),
      amountDelta: amountDelta === Infinity ? round2(Math.abs(purchase.netAmount - line.amount)) : round2(amountDelta),
    });
  }

  return candidates.sort((a, b) => b.score - a.score).slice(0, limit);
}
