import { tripCategorySeedName, type TripExpenseCategory } from '@biko/shared';

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export interface TripExportExpenseSlice {
  category: TripExpenseCategory;
  payments: Array<{ tripMemberId: string; amount: number }>;
  allocations: Array<{ tripMemberId: string; amount: number }>;
}

export interface TripExportPlanMember {
  userId: string;
  name: string;
  paid: number;
  share: number;
}

export interface TripExportPurchaseSpec {
  /** Seed category under Viajes (single purchase uses "Viajes"). */
  seedCategoryName: string;
  amount: number;
  paidByUserId: string;
  splitValues: Array<{ userId: string; value: number }>;
  payments: Array<{ userId: string; amount: number }>;
  coveredByOthers: boolean;
}

export interface TripExportCategoryMix {
  category: TripExpenseCategory;
  seedCategoryName: string;
  percent: number;
  amount: number;
  members: TripExportPlanMember[];
  purchasesCount: number;
  coveredByOthers: boolean;
}

export interface TripHouseholdExportPlan {
  netShare: number;
  categoryMix: TripExportCategoryMix[];
  /** Always 0 or 1 purchase for the household trip export. */
  purchases: TripExportPurchaseSpec[];
  /** Aggregate paid/share per household member (payments scaled to netShare). */
  members: TripExportPlanMember[];
}

export interface PlanTripHouseholdExportInput {
  expenses: TripExportExpenseSlice[];
  /** tripMemberId → hogar userId for JOINED household members on the trip */
  tripMemberToUserId: Map<string, string>;
  householdUserIds: string[];
  householdUserNames: Map<string, string>;
  exporterUserId: string;
}

function emptyAmounts(householdUserIds: string[]): Map<string, number> {
  return new Map(householdUserIds.map((id) => [id, 0]));
}

function sumMap(values: Map<string, number>): number {
  return round2([...values.values()].reduce((s, v) => s + v, 0));
}

function addAmount(map: Map<string, number>, userId: string, amount: number) {
  if (!userId || amount === 0) return;
  map.set(userId, round2((map.get(userId) ?? 0) + amount));
}

/**
 * Scale household members' trip payments so they sum to shareTotal,
 * preserving relative contribution. Empty paid → all zeros.
 */
export function scalePaidToShare(
  paidByUser: Map<string, number>,
  householdUserIds: string[],
  shareTotal: number,
): Map<string, number> {
  const scaled = emptyAmounts(householdUserIds);
  const paidTotal = sumMap(paidByUser);
  if (paidTotal <= 0 || shareTotal <= 0) return scaled;

  const payers = householdUserIds.filter((id) => (paidByUser.get(id) ?? 0) > 0);
  let allocated = 0;
  for (let i = 0; i < payers.length; i++) {
    const id = payers[i]!;
    if (i === payers.length - 1) {
      scaled.set(id, round2(shareTotal - allocated));
    } else {
      const value = round2(((paidByUser.get(id) ?? 0) / paidTotal) * shareTotal);
      scaled.set(id, value);
      allocated = round2(allocated + value);
    }
  }
  return scaled;
}

function normalizeAllocToAmount(
  householdUserIds: string[],
  alloc: Map<string, number>,
  amount: number,
): Map<string, number> {
  const next = emptyAmounts(householdUserIds);
  for (const id of householdUserIds) {
    next.set(id, Math.max(0, round2(alloc.get(id) ?? 0)));
  }
  const drift = round2(amount - sumMap(next));
  if (Math.abs(drift) < 0.005) return next;

  const ordered = [...householdUserIds].sort(
    (a, b) => (next.get(b) ?? 0) - (next.get(a) ?? 0) || a.localeCompare(b),
  );
  for (const id of ordered) {
    const adjusted = round2((next.get(id) ?? 0) + drift);
    if (adjusted >= 0) {
      next.set(id, adjusted);
      return next;
    }
  }
  if (ordered[0]) next.set(ordered[0], round2(amount));
  return next;
}

function splitFrom(householdUserIds: string[], alloc: Map<string, number>, amount: number) {
  const normalized = normalizeAllocToAmount(householdUserIds, alloc, amount);
  return householdUserIds.map((userId) => ({ userId, value: normalized.get(userId) ?? 0 }));
}

function mixMembers(
  householdUserIds: string[],
  householdUserNames: Map<string, string>,
  scaledPaid: Map<string, number>,
  shareByUser: Map<string, number>,
): TripExportPlanMember[] {
  return householdUserIds
    .map((userId) => ({
      userId,
      name: householdUserNames.get(userId) ?? userId,
      paid: scaledPaid.get(userId) ?? 0,
      share: shareByUser.get(userId) ?? 0,
    }))
    .filter((m) => m.paid > 0.005 || m.share > 0.005);
}

function primaryPayerId(
  scaledPaid: Map<string, number>,
  householdUserIds: string[],
  exporterUserId: string,
): string {
  const payers = householdUserIds
    .filter((id) => (scaledPaid.get(id) ?? 0) > 0.005)
    .sort((a, b) => {
      const diff = (scaledPaid.get(b) ?? 0) - (scaledPaid.get(a) ?? 0);
      if (diff !== 0) return diff;
      return a.localeCompare(b);
    });
  return payers[0] ?? exporterUserId;
}

/** Pure: hogar consumption by category (preview) + one Viaje purchase with global scaled payments. */
export function planTripHouseholdExport(
  input: PlanTripHouseholdExportInput,
): TripHouseholdExportPlan {
  const { expenses, tripMemberToUserId, householdUserIds, householdUserNames, exporterUserId } =
    input;

  const shareByCat = new Map<TripExpenseCategory, Map<string, number>>();
  const paidByCat = new Map<TripExpenseCategory, Map<string, number>>();
  const shareGlobal = emptyAmounts(householdUserIds);
  const paidGlobal = emptyAmounts(householdUserIds);

  const ensureCat = (category: TripExpenseCategory) => {
    if (!shareByCat.has(category)) shareByCat.set(category, emptyAmounts(householdUserIds));
    if (!paidByCat.has(category)) paidByCat.set(category, emptyAmounts(householdUserIds));
  };

  for (const expense of expenses) {
    ensureCat(expense.category);
    const share = shareByCat.get(expense.category)!;
    const paid = paidByCat.get(expense.category)!;
    for (const alloc of expense.allocations) {
      const userId = tripMemberToUserId.get(alloc.tripMemberId);
      if (userId) {
        addAmount(share, userId, alloc.amount);
        addAmount(shareGlobal, userId, alloc.amount);
      }
    }
    for (const payment of expense.payments) {
      const userId = tripMemberToUserId.get(payment.tripMemberId);
      if (userId) {
        addAmount(paid, userId, payment.amount);
        addAmount(paidGlobal, userId, payment.amount);
      }
    }
  }

  const categoryMix: TripExportCategoryMix[] = [];
  for (const [category, shareByUser] of shareByCat) {
    const shareTotal = sumMap(shareByUser);
    if (shareTotal <= 0) continue;
    const rawPaid = paidByCat.get(category) ?? emptyAmounts(householdUserIds);
    const paidTotal = sumMap(rawPaid);
    const coveredByOthers = paidTotal <= 0;
    // Preview only: show raw category paid (not scaled per category) so we don't invent
    // paid-per-category that disagrees with the single purchase payments.
    categoryMix.push({
      category,
      seedCategoryName: tripCategorySeedName(category),
      percent: 0,
      amount: shareTotal,
      members: mixMembers(householdUserIds, householdUserNames, rawPaid, shareByUser),
      purchasesCount: 0,
      coveredByOthers,
    });
  }

  const netShare = round2(categoryMix.reduce((s, c) => s + c.amount, 0));
  for (const row of categoryMix) {
    row.percent = netShare > 0 ? round2((row.amount / netShare) * 100) : 0;
  }
  categoryMix.sort((a, b) => b.amount - a.amount || a.category.localeCompare(b.category));

  if (categoryMix.length > 0) {
    const sumPct = round2(categoryMix.reduce((s, c) => s + c.percent, 0));
    const drift = round2(100 - sumPct);
    if (Math.abs(drift) >= 0.01) {
      categoryMix[0]!.percent = round2(categoryMix[0]!.percent + drift);
    }
  }

  if (netShare <= 0) {
    return { netShare: 0, categoryMix, purchases: [], members: [] };
  }

  const scaledPaid = scalePaidToShare(paidGlobal, householdUserIds, netShare);
  const coveredByOthers = sumMap(paidGlobal) <= 0;
  if (coveredByOthers) {
    scaledPaid.set(exporterUserId, netShare);
    for (const id of householdUserIds) {
      if (id !== exporterUserId) scaledPaid.set(id, 0);
    }
  }

  const paidByUserId = primaryPayerId(scaledPaid, householdUserIds, exporterUserId);
  const payments = householdUserIds
    .map((userId) => ({ userId, amount: scaledPaid.get(userId) ?? 0 }))
    .filter((p) => p.amount > 0.005);

  // Ensure payments sum exactly to netShare.
  if (payments.length === 0) {
    payments.push({ userId: exporterUserId, amount: netShare });
  } else {
    const paySum = round2(payments.reduce((s, p) => s + p.amount, 0));
    const drift = round2(netShare - paySum);
    if (Math.abs(drift) >= 0.005) {
      payments.sort((a, b) => b.amount - a.amount || a.userId.localeCompare(b.userId));
      payments[0]!.amount = round2(payments[0]!.amount + drift);
    }
  }

  const members = mixMembers(householdUserIds, householdUserNames, scaledPaid, shareGlobal);
  for (const row of categoryMix) {
    row.purchasesCount = 1;
  }

  const purchase: TripExportPurchaseSpec = {
    seedCategoryName: 'Viajes',
    amount: netShare,
    paidByUserId,
    splitValues: splitFrom(householdUserIds, shareGlobal, netShare),
    payments,
    coveredByOthers,
  };

  return { netShare, categoryMix, purchases: [purchase], members };
}
