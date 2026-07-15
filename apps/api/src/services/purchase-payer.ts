/**
 * Who paid for settle-up: snapshot first, then payment-method owner, else who logged.
 */
export function resolvePurchasePayer<T extends { id: string; name: string }>(purchase: {
  paidBy?: T | null;
  paymentMethod: { owner?: T | null };
  user: T;
}): T {
  return purchase.paidBy ?? purchase.paymentMethod.owner ?? purchase.user;
}
