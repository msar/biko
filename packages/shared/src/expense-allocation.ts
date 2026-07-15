export type SplitMode = 'EQUAL' | 'ASSIGN' | 'AMOUNT' | 'SHARES' | 'PERCENTAGE';

export interface AllocationEntry {
  userId: string;
  amount: number;
}

export interface SplitValueEntry {
  userId: string;
  value: number;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function assertMembers(memberIds: string[]): void {
  if (memberIds.length === 0) {
    throw new Error('Se requiere al menos un miembro del hogar');
  }
}

function assertMember(userId: string, memberIds: string[]): void {
  if (!memberIds.includes(userId)) {
    throw new Error('El usuario no pertenece al hogar');
  }
}

/**
 * Equal split among household members; last member absorbs rounding drift.
 */
export function buildDefaultAllocations(netAmount: number, memberIds: string[]): AllocationEntry[] {
  assertMembers(memberIds);
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
  assertMembers(memberIds);
  assertMember(myUserId, memberIds);
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
 * 100% of netAmount assigned to a single household member.
 */
export function buildAssignedAllocations(
  netAmount: number,
  assignToUserId: string,
  memberIds: string[],
): AllocationEntry[] {
  assertMembers(memberIds);
  assertMember(assignToUserId, memberIds);
  return memberIds.map((userId) => ({
    userId,
    amount: userId === assignToUserId ? round2(netAmount) : 0,
  }));
}

/**
 * Absolute ARS amounts per member. Values must cover exactly the member set and
 * sum to netAmount (within 0.01); last listed member absorbs residual drift after
 * rounding when the client sends exact totals.
 */
export function buildAmountAllocations(
  netAmount: number,
  entries: SplitValueEntry[],
  memberIds: string[],
): AllocationEntry[] {
  assertMembers(memberIds);
  if (entries.length === 0) {
    throw new Error('Se requieren montos por miembro');
  }

  const byUser = new Map(entries.map((e) => [e.userId, e.value]));
  for (const id of memberIds) {
    if (!byUser.has(id)) {
      throw new Error('Falta el monto de un miembro del hogar');
    }
  }
  for (const id of byUser.keys()) {
    assertMember(id, memberIds);
  }

  for (const entry of entries) {
    if (entry.value < 0) {
      throw new Error('Los montos no pueden ser negativos');
    }
  }

  const rawSum = round2(entries.reduce((s, e) => s + e.value, 0));
  if (Math.abs(rawSum - netAmount) > 0.01) {
    throw new Error('La suma de montos debe coincidir con el total');
  }

  let allocated = 0;
  return memberIds.map((userId, index) => {
    if (index === memberIds.length - 1) {
      return { userId, amount: round2(netAmount - allocated) };
    }
    const amount = round2(byUser.get(userId)!);
    allocated = round2(allocated + amount);
    return { userId, amount };
  });
}

/**
 * Split by integer (or fractional) share weights, e.g. 1:2.
 */
export function buildShareAllocations(
  netAmount: number,
  entries: SplitValueEntry[],
  memberIds: string[],
): AllocationEntry[] {
  assertMembers(memberIds);
  if (entries.length === 0) {
    throw new Error('Se requieren partes por miembro');
  }

  const byUser = new Map(entries.map((e) => [e.userId, e.value]));
  for (const id of memberIds) {
    if (!byUser.has(id)) {
      throw new Error('Falta la parte de un miembro del hogar');
    }
  }
  for (const id of byUser.keys()) {
    assertMember(id, memberIds);
  }

  const totalShares = entries.reduce((s, e) => s + e.value, 0);
  if (totalShares <= 0) {
    throw new Error('La suma de partes debe ser mayor a 0');
  }
  for (const entry of entries) {
    if (entry.value < 0) {
      throw new Error('Las partes no pueden ser negativas');
    }
  }

  let allocated = 0;
  return memberIds.map((userId, index) => {
    if (index === memberIds.length - 1) {
      return { userId, amount: round2(netAmount - allocated) };
    }
    const amount = round2(netAmount * (byUser.get(userId)! / totalShares));
    allocated = round2(allocated + amount);
    return { userId, amount };
  });
}

/**
 * Split by percentages that must sum to 100 (within 0.01).
 */
export function buildPercentageAllocations(
  netAmount: number,
  entries: SplitValueEntry[],
  memberIds: string[],
): AllocationEntry[] {
  assertMembers(memberIds);
  if (entries.length === 0) {
    throw new Error('Se requieren porcentajes por miembro');
  }

  const byUser = new Map(entries.map((e) => [e.userId, e.value]));
  for (const id of memberIds) {
    if (!byUser.has(id)) {
      throw new Error('Falta el porcentaje de un miembro del hogar');
    }
  }
  for (const id of byUser.keys()) {
    assertMember(id, memberIds);
  }

  for (const entry of entries) {
    if (entry.value < 0) {
      throw new Error('Los porcentajes no pueden ser negativos');
    }
  }

  const pctSum = round2(entries.reduce((s, e) => s + e.value, 0));
  if (Math.abs(pctSum - 100) > 0.01) {
    throw new Error('La suma de porcentajes debe ser 100');
  }

  let allocated = 0;
  return memberIds.map((userId, index) => {
    if (index === memberIds.length - 1) {
      return { userId, amount: round2(netAmount - allocated) };
    }
    const amount = round2(netAmount * (byUser.get(userId)! / 100));
    allocated = round2(allocated + amount);
    return { userId, amount };
  });
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

export interface BuildPurchaseAllocationsParams {
  scope: 'HOUSEHOLD' | 'PERSONAL';
  netAmount: number;
  userId: string;
  memberIds: string[];
  /** @deprecated Prefer splitMode + splitValues / assignToUserId */
  myShareAmount?: number | null;
  splitMode?: SplitMode | null;
  assignToUserId?: string | null;
  splitValues?: SplitValueEntry[] | null;
}

/**
 * Build allocations for a purchase based on scope and split mode.
 */
export function buildPurchaseAllocations(params: BuildPurchaseAllocationsParams): AllocationEntry[] {
  const {
    scope,
    netAmount,
    userId,
    memberIds,
    myShareAmount,
    splitMode,
    assignToUserId,
    splitValues,
  } = params;

  if (scope === 'PERSONAL') {
    return [{ userId, amount: round2(netAmount) }];
  }

  // Legacy alias: myShareAmount without explicit mode → custom "my share" remainder split
  if (splitMode == null && myShareAmount != null) {
    return buildCustomAllocations(netAmount, userId, myShareAmount, memberIds);
  }

  const mode: SplitMode = splitMode ?? 'EQUAL';

  switch (mode) {
    case 'EQUAL':
      return buildDefaultAllocations(netAmount, memberIds);
    case 'ASSIGN': {
      const target = assignToUserId ?? userId;
      return buildAssignedAllocations(netAmount, target, memberIds);
    }
    case 'AMOUNT': {
      if (splitValues != null && splitValues.length > 0) {
        return buildAmountAllocations(netAmount, splitValues, memberIds);
      }
      if (myShareAmount != null) {
        return buildCustomAllocations(netAmount, userId, myShareAmount, memberIds);
      }
      throw new Error('Se requieren montos para el reparto');
    }
    case 'SHARES': {
      if (splitValues == null || splitValues.length === 0) {
        throw new Error('Se requieren partes para el reparto');
      }
      return buildShareAllocations(netAmount, splitValues, memberIds);
    }
    case 'PERCENTAGE': {
      if (splitValues == null || splitValues.length === 0) {
        throw new Error('Se requieren porcentajes para el reparto');
      }
      return buildPercentageAllocations(netAmount, splitValues, memberIds);
    }
    default: {
      const _exhaustive: never = mode;
      throw new Error(`Modo de reparto desconocido: ${_exhaustive}`);
    }
  }
}
