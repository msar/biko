import type { CardNetwork, DayOfWeek, PaymentMethodType } from '@biko/shared';

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  householdId: string;
}

export interface HouseholdMember {
  id: string;
  name: string;
}

export type ExpenseScope = 'HOUSEHOLD' | 'PERSONAL';

export type PromotionApplyMode = 'auto' | 'manual' | 'off';

export interface ManualDiscount {
  label?: string | null;
  discountPercentage: number;
  discountCap?: number | null;
}

export interface Entity {
  id: string;
  name: string;
  kind: 'BANK' | 'WALLET' | 'OTHER';
}

export interface PaymentMethodDefinition {
  id: string;
  entityId: string | null;
  entity: Entity | null;
  name: string;
  type: PaymentMethodType;
  network: CardNetwork;
}

export interface PaymentMethod {
  id: string;
  definitionId: string;
  definition: PaymentMethodDefinition;
  nickname: string | null;
  lastFour: string | null;
  closingDay: number | null;
  dueDay: number | null;
  owner: { id: string; name: string } | null;
}

export interface Category {
  id: string;
  householdId: string | null;
  name: string;
  icon: string | null;
  color: string | null;
}

export interface HiddenWeeklyPromo {
  householdId: string;
  groupKey: string;
  label: string;
  createdAt: string;
}

export interface Promotion {
  id: string;
  entityId: string;
  entity: Entity;
  store: string | null;
  paymentMethodType: PaymentMethodType | null;
  cardNetwork: CardNetwork | null;
  daysOfWeek: DayOfWeek[];
  categoryIds: string[];
  discountKind: 'PERCENTAGE_REFUND' | 'INSTALLMENTS' | 'FIXED_AMOUNT' | 'OTHER';
  discountLabel: string | null;
  discountPercentage: string;
  discountCap: string | null;
  minPurchaseAmount: string | null;
  imageUrl: string | null;
  details: string[];
  provinces: string[];
  storesAdherents: boolean;
  paymentFlow: string | null;
  validFrom: string | null;
  validTo: string | null;
  source: 'MANUAL' | 'SCRAPED';
  sourceUrl: string | null;
  externalSource: string | null;
  active: boolean;
  notes: string | null;
  sponsorBank: string | null;
  sponsorBanks: string[];
}

export interface CategorySchedule {
  category: { id: string; name: string; icon: string | null };
  days: Array<{
    dayOfWeek: DayOfWeek;
    bestDiscount: number;
    promotions: DayRecommendation['promotions'];
  }>;
}

export interface ExpenseSuggestionResult {
  best: {
    paymentMethodId: string;
    paymentMethodName: string;
    suggestion: Suggestion;
  } | null;
  alternatives: Array<{
    paymentMethodId: string;
    paymentMethodName: string;
    suggestion: Suggestion;
  }>;
}

export interface PromotionSyncStatus {
  source: string;
  lastRunAt: string | null;
  lastError: string | null;
  imported: number;
  updated: number;
  deactivated: number;
}

export interface Installment {
  id: string;
  number: number;
  amount: string;
  dueDate: string;
  paid: boolean;
}

export interface PurchaseAllocation {
  userId: string;
  user: { id: string; name: string };
  amount: string;
}

export interface Purchase {
  id: string;
  clientId: string | null;
  store: string;
  description: string | null;
  purchaseDate: string;
  grossAmount: string;
  discountAmount: string;
  discountPercentageApplied: string | null;
  discountCapApplied: string | null;
  discountLabelApplied: string | null;
  netAmount: string;
  installmentsCount: number;
  scope: ExpenseScope;
  category: Category;
  user: { id: string; name: string };
  paymentMethod: PaymentMethod;
  promotion: (Promotion & { entity: Entity }) | null;
  installments: Installment[];
  allocations: PurchaseAllocation[];
  /** Solo local: pendiente de sincronizar. */
  _pending?: boolean;
}

export interface Suggestion {
  promotion: {
    id: string;
    entityId: string;
    entityName: string;
    store: string | null;
    daysOfWeek?: string[];
    discountPercentage: number;
    discountCap: number | null;
    discountKind?: string | null;
    discountLabel?: string | null;
    minPurchaseAmount?: number | null;
    notes?: string | null;
    details?: string[];
    sourceUrl?: string | null;
    sponsorBank?: string | null;
    storesAdherents?: boolean;
  };
  remainingCap: number | null;
  yearMonth: string;
  estimatedDiscount: number | null;
  estimatedNet: number | null;
}

export interface DayRecommendation {
  dayOfWeek: DayOfWeek;
  promotions: Array<{
    promotionId: string;
    entityId: string;
    entityName: string;
    store: string | null;
    discountPercentage: number;
    discountCap: number | null;
    matchedPaymentMethodId: string;
    discountKind?: string;
    discountLabel?: string | null;
    imageUrl?: string | null;
    storesAdherents?: boolean;
    categoryNames?: string[];
    notes?: string | null;
    sourceUrl?: string | null;
    minPurchaseAmount?: number | null;
    details?: string[];
  }>;
}

export interface MonthlyDashboard {
  month: string;
  total: number;
  totalSavings: number;
  byCategory: Array<{ categoryId: string; name: string; icon: string | null; color: string | null; total: number }>;
  byUser: Array<{ userId: string; name: string; total: number }>;
  byPaymentMethod: Array<{ paymentMethodId: string; name: string; total: number }>;
  installments: Array<{
    id: string;
    amount: number;
    dueDate: string;
    number: number;
    totalInstallments: number;
    paid: boolean;
    store: string;
    category: string;
    userName: string;
  }>;
}
