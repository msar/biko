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
  category: TripExpenseCategory;
  seedCategoryName: string;
  amount: number;
  paidByUserId: string;
  splitValues: Array<{ userId: string; value: number }>;
  index: number;
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
  purchases: TripExportPurchaseSpec[];
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

function splitFrom(householdUserIds: string[], alloc: Map<string, number>, amount: number) {
  const normalized = normalizeAllocToAmount(householdUserIds, alloc, amount);
  return householdUserIds.map((userId) => ({ userId, value: normalized.get(userId) ?? 0 }));
}

function addAmount(map: Map<string, number>, userId: string, amount: number) {
  if (!userId || amount === 0) return;
  map.set(userId, round2((map.get(userId) ?? 0) + amount));
}

function scalePaidToShare(
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

function allocatePurchaseAmount(
  householdUserIds: string[],
  remainingShare: Map<string, number>,
  payerId: string,
  amount: number,
): Map<string, number> {
  const alloc = emptyAmounts(householdUserIds);
  let left = amount;

  const own = Math.max(0, remainingShare.get(payerId) ?? 0);
  const toOwn = round2(Math.min(own, left));
  alloc.set(payerId, toOwn);
  left = round2(left - toOwn);
  if (left <= 0.005) return alloc;

  const partners = householdUserIds.filter((id) => id !== payerId);
  const leftoverOthers = round2(
    partners.reduce((s, id) => s + Math.max(0, remainingShare.get(id) ?? 0), 0),
  );
  if (leftoverOthers <= 0.005) {
    alloc.set(payerId, round2((alloc.get(payerId) ?? 0) + left));
    return alloc;
  }

  const withRemain = partners.filter((id) => (remainingShare.get(id) ?? 0) > 0.005);
  let allocatedPartners = 0;
  for (let i = 0; i < withRemain.length; i++) {
    const id = withRemain[i]!;
    const rem = Math.max(0, remainingShare.get(id) ?? 0);
    const isLast = i === withRemain.length - 1;
    const value = isLast
      ? round2(left - allocatedPartners)
      : round2(Math.min(rem, (rem / leftoverOthers) * left));
    alloc.set(id, value);
    allocatedPartners = round2(allocatedPartners + value);
  }
  return normalizeAllocToAmount(householdUserIds, alloc, amount);
}

function subtractAlloc(remaining: Map<string, number>, alloc: Map<string, number>) {
  for (const [id, value] of alloc) {
    remaining.set(id, round2((remaining.get(id) ?? 0) - value));
  }
}

function remainingAsAlloc(
  householdUserIds: string[],
  remainingShare: Map<string, number>,
  amount: number,
): Map<string, number> {
  const alloc = emptyAmounts(householdUserIds);
  for (const id of householdUserIds) {
    alloc.set(id, Math.max(0, round2(remainingShare.get(id) ?? 0)));
  }
  return normalizeAllocToAmount(householdUserIds, alloc, amount);
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
  if (householdUserIds[0]) {
    next.set(householdUserIds[0], amount);
    for (let i = 1; i < householdUserIds.length; i++) next.set(householdUserIds[i]!, 0);
  }
  return next;
}

function purchasesForCategory(
  category: TripExpenseCategory,
  householdUserIds: string[],
  shareByUser: Map<string, number>,
  scaledPaid: Map<string, number>,
  exporterUserId: string,
): { specs: TripExportPurchaseSpec[]; coveredByOthers: boolean } {
  const shareTotal = sumMap(shareByUser);
  const seedCategoryName = tripCategorySeedName(category);
  const paidTotal = sumMap(scaledPaid);

  if (paidTotal <= 0) {
    return {
      coveredByOthers: true,
      specs: [
        {
          category,
          seedCategoryName,
          amount: shareTotal,
          paidByUserId: exporterUserId,
          splitValues: splitFrom(householdUserIds, shareByUser, shareTotal),
          index: 0,
          coveredByOthers: true,
        },
      ],
    };
  }

  const payers = householdUserIds
    .filter((id) => (scaledPaid.get(id) ?? 0) > 0.005)
    .sort((a, b) => {
      const diff = (scaledPaid.get(b) ?? 0) - (scaledPaid.get(a) ?? 0);
      if (diff !== 0) return diff;
      return a.localeCompare(b);
    });

  if (payers.length === 1) {
    return {
      coveredByOthers: false,
      specs: [
        {
          category,
          seedCategoryName,
          amount: shareTotal,
          paidByUserId: payers[0]!,
          splitValues: splitFrom(householdUserIds, shareByUser, shareTotal),
          index: 0,
          coveredByOthers: false,
        },
      ],
    };
  }

  const remaining = new Map(shareByUser);
  const specs: TripExportPurchaseSpec[] = [];
  for (let pIndex = 0; pIndex < payers.length; pIndex++) {
    const payerId = payers[pIndex]!;
    const amount = scaledPaid.get(payerId)!;
    const alloc =
      pIndex === payers.length - 1
        ? remainingAsAlloc(householdUserIds, remaining, amount)
        : allocatePurchaseAmount(householdUserIds, remaining, payerId, amount);
    specs.push({
      category,
      seedCategoryName,
      amount,
      paidByUserId: payerId,
      splitValues: splitFrom(householdUserIds, alloc, amount),
      index: pIndex,
      coveredByOthers: false,
    });
    subtractAlloc(remaining, alloc);
  }
  return { coveredByOthers: false, specs };
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

/** Pure: hogar consumption by category, scaled paid, and purchase specs. */
export function planTripHouseholdExport(
  input: PlanTripHouseholdExportInput,
): TripHouseholdExportPlan {
  const { expenses, tripMemberToUserId, householdUserIds, householdUserNames, exporterUserId } =
    input;

  const shareByCat = new Map<TripExpenseCategory, Map<string, number>>();
  const paidByCat = new Map<TripExpenseCategory, Map<string, number>>();

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
      if (userId) addAmount(share, userId, alloc.amount);
    }
    for (const payment of expense.payments) {
      const userId = tripMemberToUserId.get(payment.tripMemberId);
      if (userId) addAmount(paid, userId, payment.amount);
    }
  }

  const purchases: TripExportPurchaseSpec[] = [];
  const categoryMix: TripExportCategoryMix[] = [];

  for (const [category, shareByUser] of shareByCat) {
    const shareTotal = sumMap(shareByUser);
    if (shareTotal <= 0) continue;
    const rawPaid = paidByCat.get(category) ?? emptyAmounts(householdUserIds);
    const scaledPaid = scalePaidToShare(rawPaid, householdUserIds, shareTotal);
    const { specs, coveredByOthers } = purchasesForCategory(
      category,
      householdUserIds,
      shareByUser,
      scaledPaid,
      exporterUserId,
    );
    purchases.push(...specs);
    categoryMix.push({
      category,
      seedCategoryName: tripCategorySeedName(category),
      percent: 0,
      amount: shareTotal,
      members: mixMembers(householdUserIds, householdUserNames, scaledPaid, shareByUser),
      purchasesCount: specs.length,
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

  return { netShare, categoryMix, purchases };
}
