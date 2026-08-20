/**
 * Who paid for settle-up / display.
 * Owned payment method → snapshot or owner.
 * Unowned method (cash/transfer) → explicit paidBy snapshot, else who logged.
 */
export function resolvePurchasePayer<T extends { id: string; name: string }>(purchase: {
  paidBy?: T | null;
  paymentMethod: { owner?: T | null };
  user: T;
}): T {
  const owner = purchase.paymentMethod.owner ?? null;
  if (owner) return purchase.paidBy ?? owner;
  return purchase.paidBy ?? purchase.user;
}

/**
 * Persist payer:
 * - payment-method owner if set (always wins)
 * - else optional explicit paidByUserId (unowned cash/transfer)
 * - else the user who logged the expense
 */
export function resolvePaidByUserId(input: {
  paymentMethodOwnerUserId: string | null | undefined;
  loggerUserId: string;
  paidByUserId?: string | null;
}): string {
  if (input.paymentMethodOwnerUserId) return input.paymentMethodOwnerUserId;
  if (input.paidByUserId) return input.paidByUserId;
  return input.loggerUserId;
}

export interface PaymentAmountInput {
  userId: string;
  amount: number;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Primary payer = largest payment; stable tie-break by userId. */
export function primaryPayerUserId(payments: PaymentAmountInput[]): string | null {
  if (payments.length === 0) return null;
  const sorted = [...payments].sort((a, b) => {
    const diff = b.amount - a.amount;
    if (Math.abs(diff) >= 0.005) return diff;
    return a.userId.localeCompare(b.userId);
  });
  return sorted[0]?.userId ?? null;
}

/**
 * Split an installment (or any slice of netAmount) across payers proportional to payment rows.
 * Falls back to single payerId when payments are empty.
 */
export function splitPaidAcrossPayers(
  sliceAmount: number,
  payments: PaymentAmountInput[],
  fallbackPayerId: string,
  netAmount: number,
): Array<{ userId: string; amount: number }> {
  if (sliceAmount <= 0) return [];
  const positive = payments.filter((p) => p.amount > 0.005);
  if (positive.length === 0) {
    return [{ userId: fallbackPayerId, amount: round2(sliceAmount) }];
  }
  const paymentTotal = round2(positive.reduce((s, p) => s + p.amount, 0));
  const denom = paymentTotal > 0.005 ? paymentTotal : netAmount > 0.005 ? netAmount : sliceAmount;
  const out: Array<{ userId: string; amount: number }> = [];
  let allocated = 0;
  for (let i = 0; i < positive.length; i++) {
    const p = positive[i]!;
    const isLast = i === positive.length - 1;
    const amount = isLast
      ? round2(sliceAmount - allocated)
      : round2((p.amount / denom) * sliceAmount);
    if (amount > 0.005) {
      out.push({ userId: p.userId, amount });
      allocated = round2(allocated + amount);
    } else if (isLast && round2(sliceAmount - allocated) > 0.005) {
      out.push({ userId: p.userId, amount: round2(sliceAmount - allocated) });
    }
  }
  if (out.length === 0) {
    return [{ userId: fallbackPayerId, amount: round2(sliceAmount) }];
  }
  return out;
}
