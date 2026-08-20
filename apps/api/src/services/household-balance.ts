import {
  allocationShareForInstallment,
  applySettlementOffsets,
  computeSettleTransfers,
  installmentCountsForSettleUp,
} from '@biko/shared';
import type { PrismaClient } from '@prisma/client';
import { resolvePurchasePayer, splitPaidAcrossPayers } from './purchase-payer.js';

function rateToArs(value: unknown): number {
  if (value == null) return 1;
  if (typeof value === 'object' && value !== null && 'toNumber' in value) {
    const n = (value as { toNumber(): number }).toNumber();
    return Number.isFinite(n) && n > 0 ? n : 1;
  }
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export interface HouseholdBalanceUser {
  userId: string;
  name: string;
  paid: number;
  share: number;
  balance: number;
}

export interface HouseholdBalanceTransfer {
  fromUserId: string;
  fromName: string;
  toUserId: string;
  toName: string;
  amount: number;
}

export interface HouseholdSettlementRow {
  id: string;
  fromUserId: string;
  fromName: string;
  toUserId: string;
  toName: string;
  amount: number;
  note: string | null;
  settledAt: Date;
  createdByUserId: string;
  createdByName: string;
}

export interface HouseholdBalanceResult {
  perUser: HouseholdBalanceUser[];
  transfers: HouseholdBalanceTransfer[];
  settlements: HouseholdSettlementRow[];
  memberNames: Map<string, string>;
}

/**
 * All-time HOUSEHOLD settle-up: due/paid installment paid/share, minus recorded settlements.
 * Future unpaid cuotas are excluded until they fall due.
 */
export async function computeHouseholdBalance(
  prisma: PrismaClient,
  householdId: string,
  opts?: { settlementLimit?: number; asOf?: Date },
): Promise<HouseholdBalanceResult> {
  const settlementLimit = opts?.settlementLimit ?? 50;
  const asOf = opts?.asOf ?? new Date();

  const [purchases, settlementRows] = await Promise.all([
    prisma.purchase.findMany({
      where: { householdId, scope: 'HOUSEHOLD', debt: null },
      include: {
        user: { select: { id: true, name: true } },
        paidBy: { select: { id: true, name: true } },
        paymentMethod: { select: { owner: { select: { id: true, name: true } } } },
        allocations: { include: { user: { select: { id: true, name: true } } } },
        payments: { include: { user: { select: { id: true, name: true } } } },
        installments: true,
      },
    }),
    prisma.householdSettlement.findMany({
      where: { householdId },
      include: {
        fromUser: { select: { id: true, name: true } },
        toUser: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
      },
      orderBy: { settledAt: 'desc' },
      take: settlementLimit,
    }),
  ]);

  const memberNames = new Map<string, string>();
  const paidByUser = new Map<string, number>();
  const shareByUser = new Map<string, number>();

  for (const purchase of purchases) {
    const rate = rateToArs(purchase.exchangeRateToArs);
    const netAmount = purchase.netAmount.toNumber();
    const payer = resolvePurchasePayer(purchase);
    memberNames.set(payer.id, payer.name);
    for (const allocation of purchase.allocations) {
      memberNames.set(allocation.userId, allocation.user.name);
    }
    const paymentRows = purchase.payments.map((p) => {
      memberNames.set(p.userId, p.user.name);
      return { userId: p.userId, amount: p.amount.toNumber() };
    });

    for (const inst of purchase.installments) {
      if (!installmentCountsForSettleUp(inst, asOf)) continue;
      const amount = inst.amount.toNumber() * rate;
      for (const slice of splitPaidAcrossPayers(amount, paymentRows, payer.id, netAmount)) {
        paidByUser.set(slice.userId, (paidByUser.get(slice.userId) ?? 0) + slice.amount);
      }

      for (const allocation of purchase.allocations) {
        const shareNative = allocationShareForInstallment(
          inst.amount.toNumber(),
          allocation.amount.toNumber(),
          netAmount,
        );
        const share = shareNative * rate;
        if (share <= 0) continue;
        shareByUser.set(allocation.userId, (shareByUser.get(allocation.userId) ?? 0) + share);
      }
    }
  }

  for (const s of settlementRows) {
    memberNames.set(s.fromUserId, s.fromUser.name);
    memberNames.set(s.toUserId, s.toUser.name);
  }

  const expensePerUser = [...memberNames.entries()].map(([userId, name]) => {
    const paid = round2(paidByUser.get(userId) ?? 0);
    const share = round2(shareByUser.get(userId) ?? 0);
    return { userId, name, paid, share, balance: round2(paid - share) };
  });

  const offsets = settlementRows.map((s) => ({
    fromUserId: s.fromUserId,
    toUserId: s.toUserId,
    amount: s.amount.toNumber(),
  }));

  const adjusted = applySettlementOffsets(
    expensePerUser.map((u) => ({ userId: u.userId, balance: u.balance })),
    offsets,
  );
  const balanceByUser = new Map(adjusted.map((b) => [b.userId, b.balance]));

  const perUser = expensePerUser
    .map((u) => ({
      ...u,
      balance: round2(balanceByUser.get(u.userId) ?? u.balance),
    }))
    .sort((a, b) => b.balance - a.balance);

  const transfers = computeSettleTransfers(perUser.map((u) => ({ userId: u.userId, balance: u.balance }))).map(
    (t) => ({
      fromUserId: t.fromUserId,
      fromName: memberNames.get(t.fromUserId) ?? '',
      toUserId: t.toUserId,
      toName: memberNames.get(t.toUserId) ?? '',
      amount: t.amount,
    }),
  );

  const settlements: HouseholdSettlementRow[] = settlementRows.map((s) => ({
    id: s.id,
    fromUserId: s.fromUserId,
    fromName: s.fromUser.name,
    toUserId: s.toUserId,
    toName: s.toUser.name,
    amount: s.amount.toNumber(),
    note: s.note,
    settledAt: s.settledAt,
    createdByUserId: s.createdByUserId,
    createdByName: s.createdBy.name,
  }));

  return { perUser, transfers, settlements, memberNames };
}

export class SettlementValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SettlementValidationError';
  }
}

/**
 * Record settlements for all currently open transfers (full liquidación).
 */
export async function createHouseholdSettlements(
  prisma: PrismaClient,
  householdId: string,
  createdByUserId: string,
  note?: string | null,
): Promise<HouseholdBalanceResult> {
  const current = await computeHouseholdBalance(prisma, householdId);
  if (current.transfers.length === 0) {
    throw new SettlementValidationError('Ya están a mano');
  }

  await prisma.$transaction(
    current.transfers.map((t) =>
      prisma.householdSettlement.create({
        data: {
          householdId,
          fromUserId: t.fromUserId,
          toUserId: t.toUserId,
          amount: t.amount,
          note: note?.trim() || null,
          createdByUserId,
        },
      }),
    ),
  );

  return computeHouseholdBalance(prisma, householdId);
}
