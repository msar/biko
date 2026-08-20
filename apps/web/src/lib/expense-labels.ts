import { fmtARS } from './api';
import type { Purchase } from './types';

export function expenseSplitLabel(exp: Purchase, userId: string): string | null {
  if (exp.scope === 'PERSONAL') return 'Personal';
  const myAlloc = exp.allocations?.find((a) => a.userId === userId);
  if (!myAlloc || !exp.allocations?.length) return null;
  const net = Number(exp.netAmount);
  const myAmount = Number(myAlloc.amount);
  if (exp.splitMode === 'ASSIGN') {
    if (myAmount >= net - 0.02) return 'Cargo: vos';
    if (myAmount <= 0.02) return 'Cargo: pareja';
  }
  const equalShare = net / exp.allocations.length;
  if (Math.abs(myAmount - equalShare) < 0.02) return null;
  return `Tu parte: ${fmtARS.format(myAmount)} / ${fmtARS.format(net)}`;
}

/**
 * Who paid: payment-method owner if set, else explicit paidBy, else who logged.
 * Matches API resolvePurchasePayer.
 */
export function resolveExpensePayer(exp: Purchase): { id: string; name: string } {
  const owner = exp.paymentMethod.owner ?? null;
  if (owner) return exp.paidBy ?? owner;
  return exp.paidBy ?? exp.user;
}

/** Positive payment rows on a purchase (multi-payer). */
export function expensePaymentRows(
  exp: Purchase,
): Array<{ userId: string; name: string; amount: number }> {
  const rows = (exp.payments ?? [])
    .map((p) => ({
      userId: p.userId,
      name: p.user.name,
      amount: Number(p.amount),
    }))
    .filter((p) => p.amount > 0.005);
  if (rows.length > 0) return rows;
  const payer = resolveExpensePayer(exp);
  return [{ userId: payer.id, name: payer.name, amount: Number(exp.netAmount) }];
}

export function expensePayerLabel(exp: Purchase, userId: string): string | null {
  const rows = expensePaymentRows(exp);
  if (rows.length > 1) {
    const names = rows.map((r) => (r.userId === userId ? 'vos' : r.name));
    if (names.length === 2) return `Pagaron: ${names[0]} y ${names[1]}`;
    return `Pagaron: ${names.join(', ')}`;
  }
  const payer = rows[0]!;
  if (payer.userId === exp.user.id) return null;
  return payer.userId === userId ? 'Pagó: vos' : `Pagó: ${payer.name}`;
}

export function expensePayerDisplayName(exp: Purchase, viewerUserId: string): string {
  const rows = expensePaymentRows(exp);
  if (rows.length > 1) {
    return rows.map((r) => (r.userId === viewerUserId ? 'Vos' : r.name)).join(' y ');
  }
  const payer = rows[0]!;
  return payer.userId === viewerUserId ? 'Vos' : payer.name;
}
