export type TripStatus = 'PLANNING' | 'ACTIVE' | 'CLOSED';
export type TripMemberRole = 'ORGANIZER' | 'MEMBER';
export type TripExpenseCategory =
  | 'ALOJAMIENTO'
  | 'VUELOS'
  | 'TRANSPORTE'
  | 'COMIDA'
  | 'RESTAURANTES'
  | 'ACTIVIDADES'
  | 'OTROS';
export type TripListItemType = 'TODO' | 'PACK' | 'BUY';
export type TripListItemStatus = 'PENDING' | 'DONE';
export type SplitMode = 'EQUAL' | 'ASSIGN' | 'AMOUNT' | 'SHARES' | 'PERCENTAGE';

export interface TripListItem {
  id: string;
  name: string;
  destination: string | null;
  destinationTimezone?: string | null;
  startDate: string | null;
  endDate: string | null;
  status: TripStatus;
  baseCurrency: string;
  memberCount: number;
  expenseCount: number;
  exportedAt: string | null;
  updatedAt: string;
  createdAt: string;
}

export interface TripMember {
  id: string;
  tripId: string;
  userId: string | null;
  displayName: string;
  role: TripMemberRole;
  inviteStatus: string;
  tripHouseholdId: string | null;
  createdAt: string;
}

export interface TripHousehold {
  id: string;
  tripId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface TripAccommodation {
  id: string;
  label: string | null;
  address: string | null;
  checkIn: string | null;
  checkOut: string | null;
  checkInTime: string | null;
  checkOutTime: string | null;
  amount: number | null;
  expenseId: string | null;
  link: string | null;
  notes: string | null;
}

export interface TripBalanceMember {
  memberId: string;
  displayName: string;
  userId: string | null;
  tripHouseholdId: string | null;
  paid: number;
  share: number;
  balance: number;
}

export interface TripBalanceUnit {
  unitId: string;
  kind: 'HOUSEHOLD' | 'MEMBER';
  displayName: string;
  tripHouseholdId: string | null;
  memberIds: string[];
  representativeMemberId: string;
  paid: number;
  share: number;
  balance: number;
}

export interface TripBalanceTransfer {
  fromUnitId: string;
  fromName: string;
  toUnitId: string;
  toName: string;
  amount: number;
  fromMemberId: string;
  toMemberId: string;
}

export interface TripSettlement {
  id: string;
  fromMemberId: string;
  fromName: string;
  toMemberId: string;
  toName: string;
  amount: number;
  note: string | null;
  settledAt: string;
}

export interface TripCategoryTotal {
  category: TripExpenseCategory;
  total: number;
  percent: number;
}

export interface TripHub {
  id: string;
  createdByUserId: string;
  name: string;
  shareSlug: string;
  destination: string | null;
  destinationTimezone?: string | null;
  startDate: string | null;
  endDate: string | null;
  status: TripStatus;
  baseCurrency: string;
  exportHouseholdId: string | null;
  exportBatchId: string | null;
  exportedAt: string | null;
  createdAt: string;
  updatedAt: string;
  members: TripMember[];
  households: TripHousehold[];
  /** Share path slug (same as shareSlug); kept for copy-link UX. */
  inviteCode: string | null;
  accommodation: TripAccommodation | null;
  myMember: TripMember;
  isOrganizer: boolean;
  canExport: boolean;
  alreadyExported: boolean;
  isGuestSession: boolean;
  balance: {
    perMember: TripBalanceMember[];
    perUnit: TripBalanceUnit[];
    transfers: TripBalanceTransfer[];
    settlements: TripSettlement[];
  };
  categoryTotals: TripCategoryTotal[];
  totalSpent: number;
}

export interface TripExpense {
  id: string;
  tripId: string;
  paidByMemberId: string;
  paidByMember: { id: string; displayName: string; userId: string | null };
  amount: number;
  category: TripExpenseCategory;
  note: string | null;
  date: string;
  currency: string;
  splitMode: SplitMode;
  exportedPurchaseId: string | null;
  createdAt: string;
  updatedAt: string;
  payments: Array<{
    id: string;
    tripMemberId: string;
    amount: number;
    displayName: string;
    userId: string | null;
  }>;
  allocations: Array<{
    id: string;
    tripMemberId: string;
    amount: number;
    displayName: string;
    userId: string | null;
  }>;
  /** Present on get-by-id when this expense is linked to trip accommodation. */
  accommodation?: {
    id: string;
    label: string | null;
    address: string | null;
  } | null;
}

export interface TripListItemRow {
  id: string;
  tripId: string;
  type: TripListItemType;
  title: string;
  notes: string | null;
  quantity: number | null;
  assignToAll: boolean;
  assignees: TripMember[];
  status: TripListItemStatus;
  dayDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TripExportPreview {
  eligible: boolean;
  reason?: string;
  tripId: string;
  householdId: string;
  netShare: number;
  alreadyExported: boolean;
  categoryMix: Array<{
    category: TripExpenseCategory;
    seedCategoryName: string;
    percent: number;
    amount: number;
  }>;
}

export interface TripInvitePreview {
  code: string;
  inviteToken?: string;
  expiresAt: string | null;
  trip: {
    id: string;
    name: string;
    shareSlug?: string;
    destination: string | null;
    destinationTimezone?: string | null;
    status: TripStatus;
    startDate: string | null;
    endDate: string | null;
  };
  unclaimedMembers: TripMember[];
}

export type TripPackingSection = 'clima' | 'destino' | 'viaje';

export interface TripPackingSuggestion {
  title: string;
  reason: string;
  section?: TripPackingSection;
}

export interface TripForecastDaily {
  date: string;
  tMax: number;
  tMin: number;
  precipProb: number;
  weatherCode: number;
  uvIndexMax?: number;
  precipSum?: number;
  windSpeedMax?: number;
}

export interface TripForecast {
  location: {
    name: string;
    country?: string;
    latitude: number;
    longitude: number;
    elevation?: number;
  };
  range: { start: string; end: string; truncated: boolean };
  daily: TripForecastDaily[];
  summary: {
    tMin: number;
    tMax: number;
    rainyDays: number;
    label: string;
    climateLabel?: string | null;
  };
  packingSuggestions: TripPackingSuggestion[];
}
