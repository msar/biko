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
