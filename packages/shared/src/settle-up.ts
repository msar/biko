export interface UserBalance {
  userId: string;
  balance: number;
}

export interface SettleTransfer {
  fromUserId: string;
  toUserId: string;
  amount: number;
}

export interface SettlementOffset {
  fromUserId: string;
  toUserId: string;
  amount: number;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Apply recorded settlements to expense balances.
 * When fromUser pays toUser, fromUser's debt shrinks (balance += amount)
 * and toUser's credit shrinks (balance -= amount).
 */
export function applySettlementOffsets(
  balances: UserBalance[],
  settlements: SettlementOffset[],
): UserBalance[] {
  const byUser = new Map(balances.map((b) => [b.userId, round2(b.balance)]));

  for (const s of settlements) {
    if (s.amount <= 0) continue;
    byUser.set(s.fromUserId, round2((byUser.get(s.fromUserId) ?? 0) + s.amount));
    byUser.set(s.toUserId, round2((byUser.get(s.toUserId) ?? 0) - s.amount));
  }

  // Preserve original order, then append any users only present in settlements.
  const seen = new Set<string>();
  const result: UserBalance[] = [];
  for (const b of balances) {
    seen.add(b.userId);
    result.push({ userId: b.userId, balance: byUser.get(b.userId) ?? 0 });
  }
  for (const [userId, balance] of byUser) {
    if (seen.has(userId)) continue;
    result.push({ userId, balance });
  }
  return result;
}

/**
 * Minimal cash-flow netting: greedily match the largest debtor against the
 * largest creditor until everyone is settled. `balance` is paid - share,
 * so positive = is owed money (creditor), negative = owes money (debtor).
 * Residues below one cent are ignored.
 */
export function computeSettleTransfers(balances: UserBalance[]): SettleTransfer[] {
  const creditors = balances
    .map((b) => ({ userId: b.userId, amount: round2(b.balance) }))
    .filter((b) => b.amount > 0.005)
    .sort((a, b) => b.amount - a.amount);
  const debtors = balances
    .map((b) => ({ userId: b.userId, amount: round2(-b.balance) }))
    .filter((b) => b.amount > 0.005)
    .sort((a, b) => b.amount - a.amount);

  const transfers: SettleTransfer[] = [];
  let ci = 0;
  let di = 0;

  while (ci < creditors.length && di < debtors.length) {
    const creditor = creditors[ci]!;
    const debtor = debtors[di]!;
    const amount = round2(Math.min(creditor.amount, debtor.amount));

    if (amount > 0.005) {
      transfers.push({ fromUserId: debtor.userId, toUserId: creditor.userId, amount });
    }

    creditor.amount = round2(creditor.amount - amount);
    debtor.amount = round2(debtor.amount - amount);

    if (creditor.amount <= 0.005) ci++;
    if (debtor.amount <= 0.005) di++;
  }

  return transfers;
}
