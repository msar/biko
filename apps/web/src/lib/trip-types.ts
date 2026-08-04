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
  createdAt: string;
}

export interface TripAccommodation {
  id: string;
  label: string | null;
  address: string | null;
  checkIn: string | null;
  checkOut: string | null;
  link: string | null;
  notes: string | null;
}

export interface TripBalanceMember {
  memberId: string;
  displayName: string;
  userId: string | null;
  paid: number;
  share: number;
  balance: number;
}

export interface TripBalanceTransfer {
  fromMemberId: string;
  fromName: string;
  toMemberId: string;
  toName: string;
  amount: number;
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
  destination: string | null;
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
  inviteCode: string | null;
  accommodation: TripAccommodation | null;
  myMember: TripMember;
  isOrganizer: boolean;
  canExport: boolean;
  alreadyExported: boolean;
  isGuestSession: boolean;
  balance: {
    perMember: TripBalanceMember[];
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
  allocations: Array<{
    id: string;
    tripMemberId: string;
    amount: number;
    displayName: string;
    userId: string | null;
  }>;
}

export interface TripListItemRow {
  id: string;
  tripId: string;
  type: TripListItemType;
  title: string;
  notes: string | null;
  quantity: number | null;
  assigneeMemberId: string | null;
  assigneeMember: TripMember | null;
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
