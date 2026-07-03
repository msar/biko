export interface AllocationEntry {
  userId: string;
  amount: number;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Equal split among household members; last member absorbs rounding drift.
 */
export function buildDefaultAllocations(netAmount: number, memberIds: string[]): AllocationEntry[] {
  if (memberIds.length === 0) {
    throw new Error('Se requiere al menos un miembro del hogar');
  }
  const base = round2(netAmount / memberIds.length);
  let allocated = 0;
  return memberIds.map((userId, index) => {
    if (index === memberIds.length - 1) {
      return { userId, amount: round2(netAmount - allocated) };
    }
    allocated = round2(allocated + base);
    return { userId, amount: base };
  });
}

/**
 * Custom split: myShareAmount to myUserId, remainder split equally among others.
 */
export function buildCustomAllocations(
  netAmount: number,
  myUserId: string,
  myShareAmount: number,
  memberIds: string[],
): AllocationEntry[] {
  if (memberIds.length === 0) {
    throw new Error('Se requiere al menos un miembro del hogar');
  }
  if (!memberIds.includes(myUserId)) {
    throw new Error('El usuario no pertenece al hogar');
  }
  if (myShareAmount <= 0 || myShareAmount > netAmount) {
    throw new Error('Mi parte debe ser mayor a 0 y no superar el total');
  }

  if (memberIds.length === 1) {
    return [{ userId: myUserId, amount: round2(netAmount) }];
  }

  const others = memberIds.filter((id) => id !== myUserId);
  const remainder = round2(netAmount - myShareAmount);
  const otherAllocs = buildDefaultAllocations(remainder, others);
  return [{ userId: myUserId, amount: round2(myShareAmount) }, ...otherAllocs];
}

/**
 * Proportional share of an installment amount for dashboard attribution.
 */
export function allocationShareForInstallment(
  installmentAmount: number,
  userAllocation: number,
  netAmount: number,
): number {
  if (netAmount <= 0) return 0;
  return round2(installmentAmount * (userAllocation / netAmount));
}

/**
 * Build allocations for a purchase based on scope and optional custom share.
 */
export function buildPurchaseAllocations(params: {
  scope: 'HOUSEHOLD' | 'PERSONAL';
  netAmount: number;
  userId: string;
  memberIds: string[];
  myShareAmount?: number | null;
}): AllocationEntry[] {
  const { scope, netAmount, userId, memberIds, myShareAmount } = params;

  if (scope === 'PERSONAL') {
    return [{ userId, amount: round2(netAmount) }];
  }

  if (myShareAmount != null) {
    return buildCustomAllocations(netAmount, userId, myShareAmount, memberIds);
  }

  return buildDefaultAllocations(netAmount, memberIds);
}
