/**
 * Who paid for settle-up / display.
 * Owned payment method → snapshot or owner.
 * Unowned method (cash/transfer) → who logged the expense (never the later editor).
 */
export function resolvePurchasePayer<T extends { id: string; name: string }>(purchase: {
  paidBy?: T | null;
  paymentMethod: { owner?: T | null };
  user: T;
}): T {
  const owner = purchase.paymentMethod.owner ?? null;
  if (owner) return purchase.paidBy ?? owner;
  return purchase.user;
}

/** Persist payer: payment-method owner if set, else the user who logged the expense. */
export function resolvePaidByUserId(input: {
  paymentMethodOwnerUserId: string | null | undefined;
  loggerUserId: string;
}): string {
  return input.paymentMethodOwnerUserId ?? input.loggerUserId;
}
