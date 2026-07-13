export interface UserBalance {
  userId: string;
  balance: number;
}

export interface SettleTransfer {
  fromUserId: string;
  toUserId: string;
  amount: number;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
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
