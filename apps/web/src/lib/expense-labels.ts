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
 * Who paid: payment-method owner if set, else who logged the expense.
 * Matches API resolvePurchasePayer (unowned methods ignore a stale paidBy snapshot).
 */
export function resolveExpensePayer(exp: Purchase): { id: string; name: string } {
  const owner = exp.paymentMethod.owner ?? null;
  if (owner) return exp.paidBy ?? owner;
  return exp.user;
}

export function expensePayerLabel(exp: Purchase, userId: string): string | null {
  const payer = resolveExpensePayer(exp);
  if (payer.id === exp.user.id) return null;
  return payer.id === userId ? 'Pagó: vos' : `Pagó: ${payer.name}`;
}

export function expensePayerDisplayName(exp: Purchase, viewerUserId: string): string {
  const payer = resolveExpensePayer(exp);
  return payer.id === viewerUserId ? 'Vos' : payer.name;
}
