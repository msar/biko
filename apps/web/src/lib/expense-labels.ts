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

export function expensePayerLabel(exp: Purchase, userId: string): string | null {
  const payer = exp.paidBy ?? exp.paymentMethod.owner ?? null;
  if (!payer) return null;
  if (payer.id === exp.user.id) return null;
  return payer.id === userId ? 'Pagó: vos' : `Pagó: ${payer.name}`;
}
