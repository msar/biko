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

export interface PartyParticipantPaid {
  id: string;
  paid: number;
}

export interface PartyEqualSplitResult {
  total: number;
  share: number;
  balances: UserBalance[];
}

/**
 * Equal-split balances for an ad-hoc gathering: each person's balance is
 * `paid - share`, where share is total / n. Positive = creditor.
 * Returns zeros when there are fewer than two participants.
 */
export function computePartyEqualSplit(participants: PartyParticipantPaid[]): PartyEqualSplitResult {
  if (participants.length < 2) {
    return {
      total: 0,
      share: 0,
      balances: participants.map((p) => ({ userId: p.id, balance: 0 })),
    };
  }

  const total = round2(participants.reduce((sum, p) => sum + Math.max(0, p.paid), 0));
  const share = round2(total / participants.length);
  const balances = participants.map((p) => ({
    userId: p.id,
    balance: round2(Math.max(0, p.paid) - share),
  }));

  return { total, share, balances };
}

/**
 * Whether an installment counts toward household settle-up as of `asOf`.
 * Counts if already marked paid, or if its due date has arrived (card cuotas
 * start as unpaid but still create debt once due).
 */
export function installmentCountsForSettleUp(
  inst: { paid: boolean; dueDate: Date },
  asOf: Date = new Date(),
): boolean {
  if (inst.paid) return true;
  const endOfAsOf = new Date(asOf);
  endOfAsOf.setHours(23, 59, 59, 999);
  return inst.dueDate.getTime() <= endOfAsOf.getTime();
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
