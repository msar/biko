import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { findCandidatePromotions, calculateDiscount } from '@biko/shared';
import StoreAutocomplete from './StoreAutocomplete';
import ExpenseSuggestionPromo, { suggestionBenefitText } from './ExpenseSuggestionPromo';
import { api, fmtARS } from '../lib/api';
import {
  applyRemainingToAmount,
  moneyRemaining,
  parseMoneyInput,
  remainingBalance,
  remainingHintLabel,
} from '../lib/amount-remaining';
import { useAuth } from '../lib/auth';
import { resolveExpensePayer } from '../lib/expense-labels';
import { enqueueExpense, type OutboxExpense } from '../lib/outbox';
import { ensureStoreSuggestionsCache, rememberStoreFromExpense } from '../lib/store-suggestions';
import { groupMethodsByEntity, paymentMethodDisplayName } from '../lib/payment-method-catalog';
import type {
  Category,
  ExpenseScope,
  ExpenseSuggestionResult,
  HouseholdMember,
  PaymentMethod,
  Promotion,
  PromotionApplyMode,
  Purchase,
  SplitMode,
  Suggestion,
} from '../lib/types';

type ChargeTo = 'me' | 'partner' | 'split';
type SplitSubMode = 'EQUAL' | 'AMOUNT' | 'SHARES' | 'PERCENTAGE';

function promotionOptionLabel(p: Promotion, categories: Category[] | undefined): string {
  const pct = Number(p.discountPercentage);
  const store = p.store ? ` · ${p.store}` : '';
  const cap = p.discountCap ? ` · tope ${fmtARS.format(Number(p.discountCap))}` : '';
  const catNames = p.categoryIds
    .map((id) => categories?.find((c) => c.id === id)?.name)
    .filter(Boolean);
  const cats = catNames.length ? ` · ${catNames.join(', ')}` : '';
  return `${pct}% ${p.entity.name}${store}${cap}${cats}`;
}

function resolvePromotionStateFromPurchase(purchase: Purchase): {
  promotionMode: PromotionApplyMode;
  manualSource: 'existing' | 'custom';
  promotionId: string | null;
  manualLabel: string;
  manualPct: string;
  manualCap: string;
} {
  const hasDiscount = Number(purchase.discountAmount) > 0;

  if (!hasDiscount && !purchase.promotion) {
    return {
      promotionMode: 'off',
      manualSource: 'custom',
      promotionId: null,
      manualLabel: '',
      manualPct: '',
      manualCap: '',
    };
  }

  if (purchase.discountLabelApplied && purchase.promotion?.id) {
    return {
      promotionMode: 'manual',
      manualSource: 'existing',
      promotionId: purchase.promotion.id,
      manualLabel: '',
      manualPct: '',
      manualCap: '',
    };
  }

  if (purchase.discountLabelApplied || (!purchase.promotion && hasDiscount)) {
    return {
      promotionMode: 'manual',
      manualSource: 'custom',
      promotionId: null,
      manualLabel: purchase.discountLabelApplied ?? '',
      manualPct: purchase.discountPercentageApplied
        ? String(Number(purchase.discountPercentageApplied))
        : '',
      manualCap: purchase.discountCapApplied ? String(Number(purchase.discountCapApplied)) : '',
    };
  }

  if (purchase.promotion?.id && !purchase.discountLabelApplied) {
    return {
      promotionMode: 'auto',
      manualSource: 'existing',
      promotionId: purchase.promotion.id,
      manualLabel: '',
      manualPct: '',
      manualCap: '',
    };
  }

  return {
    promotionMode: 'auto',
    manualSource: 'custom',
    promotionId: null,
    manualLabel: '',
    manualPct: '',
    manualCap: '',
  };
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function purchaseDateToISO(purchaseDate: string): string {
  return purchaseDate.slice(0, 10);
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

export interface ExpenseFormInitial {
  amount: string;
  categoryId: string | null;
  paymentMethodId: string | null;
  store: string;
  date: string;
  installments: number;
  promotionMode: PromotionApplyMode;
  manualSource: 'existing' | 'custom';
  promotionId: string | null;
  manualLabel: string;
  manualPct: string;
  manualCap: string;
  scope: ExpenseScope;
  chargeTo: ChargeTo;
  splitSubMode: SplitSubMode;
  myAmount: string;
  partnerAmount: string;
  myShares: string;
  partnerShares: string;
  myPct: string;
  partnerPct: string;
  /** Who logged the expense (edit mode) — used when payment method has no owner. */
  loggedByUserId?: string;
  loggedByName?: string;
  /** Who paid — for unowned payment methods. */
  paidByUserId?: string;
}

function initialFromPurchase(purchase: Purchase, userId: string): ExpenseFormInitial {
  const promoState = resolvePromotionStateFromPurchase(purchase);
  const partnerAlloc = purchase.allocations.find((a) => a.userId !== userId);
  const myAlloc = purchase.allocations.find((a) => a.userId === userId);
  const netAmount = Number(purchase.netAmount);
  const myAmount = myAlloc ? Number(myAlloc.amount) : 0;
  const partnerAmount = partnerAlloc ? Number(partnerAlloc.amount) : Math.max(0, netAmount - myAmount);
  const mode = purchase.splitMode ?? 'EQUAL';

  let chargeTo: ChargeTo = 'split';
  let splitSubMode: SplitSubMode = 'EQUAL';

  if (purchase.scope === 'PERSONAL') {
    chargeTo = 'me';
    splitSubMode = 'EQUAL';
  } else if (mode === 'ASSIGN') {
    if (myAmount >= netAmount - 0.02) chargeTo = 'me';
    else if (partnerAmount >= netAmount - 0.02) chargeTo = 'partner';
    else chargeTo = 'split';
    splitSubMode = 'EQUAL';
  } else if (mode === 'EQUAL') {
    chargeTo = 'split';
    splitSubMode = 'EQUAL';
  } else {
    chargeTo = 'split';
    splitSubMode = mode;
  }

  const myPct = netAmount > 0 ? Math.round((myAmount / netAmount) * 1000) / 10 : 50;
  const partnerPct = Math.round((100 - myPct) * 10) / 10;

  return {
    amount: String(Number(purchase.grossAmount)),
    categoryId: purchase.category.id,
    paymentMethodId: purchase.paymentMethod.id,
    store: purchase.store,
    date: purchaseDateToISO(purchase.purchaseDate),
    installments: purchase.installmentsCount,
    ...promoState,
    scope: purchase.scope,
    chargeTo,
    splitSubMode,
    myAmount: String(Math.round(myAmount * 100) / 100),
    partnerAmount: String(Math.round(partnerAmount * 100) / 100),
    myShares: '1',
    partnerShares: '1',
    myPct: String(myPct),
    partnerPct: String(partnerPct),
    loggedByUserId: purchase.user.id,
    loggedByName: purchase.user.name,
    paidByUserId: resolveExpensePayer(purchase).id,
  };
}

interface ExpenseFormProps {
  mode: 'create' | 'edit';
  purchaseId?: string;
  initial?: Partial<ExpenseFormInitial>;
  title: string;
}

export default function ExpenseForm({ mode, purchaseId, initial, title }: ExpenseFormProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const [amount, setAmount] = useState(initial?.amount ?? '');
  const [categoryId, setCategoryId] = useState<string | null>(initial?.categoryId ?? null);
  const [paymentMethodId, setPaymentMethodId] = useState<string | null>(initial?.paymentMethodId ?? null);
  const [store, setStore] = useState(initial?.store ?? '');
  const [date, setDate] = useState(initial?.date ?? todayISO());
  const [installments, setInstallments] = useState(initial?.installments ?? 1);
  const [promotionMode, setPromotionMode] = useState<PromotionApplyMode>(initial?.promotionMode ?? 'auto');
  const [manualSource, setManualSource] = useState<'existing' | 'custom'>(initial?.manualSource ?? 'custom');
  const [selectedPromotionId, setSelectedPromotionId] = useState<string | null>(initial?.promotionId ?? null);
  const [manualLabel, setManualLabel] = useState(initial?.manualLabel ?? '');
  const [manualPct, setManualPct] = useState(initial?.manualPct ?? '');
  const [manualCap, setManualCap] = useState(initial?.manualCap ?? '');
  const [scope, setScope] = useState<ExpenseScope>(initial?.scope ?? 'HOUSEHOLD');
  const [chargeTo, setChargeTo] = useState<ChargeTo>(initial?.chargeTo ?? 'split');
  const [splitSubMode, setSplitSubMode] = useState<SplitSubMode>(initial?.splitSubMode ?? 'EQUAL');
  const [myAmount, setMyAmount] = useState(initial?.myAmount ?? '');
  const [partnerAmount, setPartnerAmount] = useState(initial?.partnerAmount ?? '');
  const [myShares, setMyShares] = useState(initial?.myShares ?? '1');
  const [partnerShares, setPartnerShares] = useState(initial?.partnerShares ?? '1');
  const [myPct, setMyPct] = useState(initial?.myPct ?? '50');
  const [partnerPct, setPartnerPct] = useState(initial?.partnerPct ?? '50');
  const [paidByUserId, setPaidByUserId] = useState<string | null>(initial?.paidByUserId ?? null);
  const [error, setError] = useState<string | null>(null);
  const [savedOffline, setSavedOffline] = useState(false);

  const { data: me } = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () =>
      api<{
        id: string;
        household: { members: HouseholdMember[] };
      }>('/auth/me'),
  });

  const members = me?.household.members ?? [];
  const partner = members.find((m) => m.id !== user?.id) ?? null;

  const { data: categories } = useQuery({
    queryKey: ['categories'],
    queryFn: () => api<Category[]>('/categories'),
  });
  const { data: methods } = useQuery({
    queryKey: ['payment-methods'],
    queryFn: () => api<PaymentMethod[]>('/payment-methods'),
  });
  const { data: promotions } = useQuery({
    queryKey: ['promotions'],
    queryFn: () => api<Promotion[]>('/promotions'),
  });
  const { data: expenses } = useQuery({
    queryKey: ['expenses'],
    queryFn: () => api<Purchase[]>('/expenses'),
  });

  const [storeSuggestions, setStoreSuggestions] = useState<string[]>([]);

  useEffect(() => {
    if (!promotions) return;
    const stores = ensureStoreSuggestionsCache({
      promotions: promotions.filter((p) => p.active),
      expenses: expenses ?? [],
    });
    setStoreSuggestions(stores);
  }, [promotions, expenses]);

  const selectedMethod = methods?.find((m) => m.id === paymentMethodId) ?? null;
  const isCredit = selectedMethod?.definition.type === 'CREDIT_CARD';
  const methodHasOwner = Boolean(selectedMethod?.owner);
  const grossAmount = Number(amount) || 0;

  // Default payer for unowned methods: create → current user; edit → initial / logger.
  useEffect(() => {
    if (!selectedMethod || selectedMethod.owner) return;
    setPaidByUserId((prev) => {
      if (prev && members.some((m) => m.id === prev)) return prev;
      if (initial?.paidByUserId && members.some((m) => m.id === initial.paidByUserId)) {
        return initial.paidByUserId;
      }
      if (mode === 'edit' && initial?.loggedByUserId) return initial.loggedByUserId;
      return user?.id ?? null;
    });
  }, [selectedMethod, members, initial?.paidByUserId, initial?.loggedByUserId, mode, user?.id]);

  const debouncedStore = useDebounced(store, 400);
  const debouncedAmount = useDebounced(grossAmount, 400);

  const autoPromotion = promotionMode === 'auto';

  const { data: expenseSuggestion } = useQuery({
    queryKey: ['suggest-expense', categoryId, debouncedStore, date, debouncedAmount, promotionMode],
    queryFn: () =>
      api<ExpenseSuggestionResult>(
        `/promotions/suggest-expense?date=${date}T12:00:00${categoryId ? `&categoryId=${categoryId}` : ''}${debouncedStore ? `&store=${encodeURIComponent(debouncedStore)}` : ''}${debouncedAmount ? `&amount=${debouncedAmount}` : ''}`,
      ),
    enabled: Boolean(autoPromotion && navigator.onLine && (categoryId || debouncedStore)),
  });

  const { data: serverSuggestion } = useQuery({
    queryKey: ['suggest', paymentMethodId, categoryId, debouncedStore, date, debouncedAmount, promotionMode],
    queryFn: () =>
      api<{ suggestion: Suggestion | null }>(
        `/promotions/suggest?paymentMethodId=${paymentMethodId}&date=${date}T12:00:00${categoryId ? `&categoryId=${categoryId}` : ''}${debouncedStore ? `&store=${encodeURIComponent(debouncedStore)}` : ''}${debouncedAmount ? `&amount=${debouncedAmount}` : ''}`,
      ),
    enabled: Boolean(paymentMethodId && autoPromotion && navigator.onLine),
  });

  const offlineSuggestion = useMemo(() => {
    if (!autoPromotion || navigator.onLine || !selectedMethod || !promotions) return null;
    const def = selectedMethod.definition;
    if (!def.entityId) return null;
    const candidates = findCandidatePromotions({
      promotions: promotions
        .filter((p) => p.active)
        .map((p) => ({
          id: p.id,
          entityId: p.entityId,
          entityName: p.entity.name,
          store: p.store,
          daysOfWeek: p.daysOfWeek,
          categoryIds: p.categoryIds,
          paymentMethodType: p.paymentMethodType,
          cardNetwork: p.cardNetwork,
          discountPercentage: Number(p.discountPercentage),
          discountCap: p.discountCap ? Number(p.discountCap) : null,
          minPurchaseAmount: p.minPurchaseAmount ? Number(p.minPurchaseAmount) : null,
          validFrom: p.validFrom,
          validTo: p.validTo,
          active: p.active,
        })),
      paymentMethod: {
        entityId: def.entityId,
        entityName: def.entity?.name ?? '',
        type: def.type,
        network: def.network,
      },
      date: new Date(`${date}T12:00:00`),
      store: store || null,
      grossAmount: grossAmount || null,
      categoryId,
    });
    const first = candidates[0];
    if (!first) return null;
    const est = grossAmount
      ? calculateDiscount(grossAmount, first.promotion.discountPercentage, first.promotion.discountCap)
      : null;
    return { promotion: first.promotion, estimatedDiscount: est?.discountAmount ?? null };
  }, [autoPromotion, selectedMethod, promotions, date, store, grossAmount, categoryId]);

  const selectedManualPromo = promotions?.find((p) => p.id === selectedPromotionId) ?? null;

  const manualDiscountPreview = useMemo(() => {
    if (promotionMode !== 'manual' || !grossAmount) return null;
    if (manualSource === 'existing' && selectedManualPromo) {
      return calculateDiscount(
        grossAmount,
        Number(selectedManualPromo.discountPercentage),
        selectedManualPromo.discountCap ? Number(selectedManualPromo.discountCap) : null,
      );
    }
    if (manualSource === 'custom') {
      const pct = Number(manualPct);
      if (!pct || pct <= 0) return null;
      const cap = manualCap ? Number(manualCap) : null;
      return calculateDiscount(grossAmount, pct, cap);
    }
    return null;
  }, [promotionMode, grossAmount, manualSource, selectedManualPromo, manualPct, manualCap]);

  const selectablePromos = useMemo(() => {
    if (!promotions) return [];
    return promotions
      .filter((p) => p.active && Number(p.discountPercentage) > 0 && p.discountKind !== 'INSTALLMENTS')
      .sort((a, b) => {
        const aMatch = categoryId && a.categoryIds.includes(categoryId) ? 1 : 0;
        const bMatch = categoryId && b.categoryIds.includes(categoryId) ? 1 : 0;
        if (aMatch !== bMatch) return bMatch - aMatch;
        return a.entity.name.localeCompare(b.entity.name);
      });
  }, [promotions, categoryId]);

  const suggestion = serverSuggestion?.suggestion ?? null;
  const best = expenseSuggestion?.best ?? null;
  const offline = !navigator.onLine;

  const estimatedNet = useMemo(() => {
    if (!grossAmount) return 0;
    if (promotionMode === 'manual' && manualDiscountPreview) return manualDiscountPreview.netAmount;
    if (promotionMode !== 'auto') return grossAmount;
    if (suggestion?.estimatedNet != null) return suggestion.estimatedNet;
    if (best?.suggestion.estimatedNet != null && paymentMethodId === best.paymentMethodId) {
      return best.suggestion.estimatedNet;
    }
    if (offlineSuggestion?.estimatedDiscount != null) {
      return grossAmount - offlineSuggestion.estimatedDiscount;
    }
    return grossAmount;
  }, [grossAmount, promotionMode, manualDiscountPreview, suggestion, best, paymentMethodId, offlineSuggestion]);

  const equalShare = members.length > 0 ? estimatedNet / members.length : estimatedNet;

  const previewShares = useMemo(() => {
    if (scope !== 'HOUSEHOLD' || !user?.id) {
      return { me: estimatedNet, partner: 0 };
    }
    if (chargeTo === 'me') return { me: estimatedNet, partner: 0 };
    if (chargeTo === 'partner') return { me: 0, partner: estimatedNet };
    if (splitSubMode === 'EQUAL') {
      return { me: equalShare, partner: Math.max(0, estimatedNet - equalShare) };
    }
    if (splitSubMode === 'AMOUNT') {
      const mine = parseMoneyInput(myAmount);
      const theirs = parseMoneyInput(partnerAmount);
      return { me: mine, partner: theirs };
    }
    if (splitSubMode === 'SHARES') {
      const a = Number(myShares) || 0;
      const b = Number(partnerShares) || 0;
      const total = a + b;
      if (total <= 0) return { me: 0, partner: 0 };
      const me = Math.round(((estimatedNet * a) / total) * 100) / 100;
      return { me, partner: Math.round((estimatedNet - me) * 100) / 100 };
    }
    const a = Number(myPct) || 0;
    const me = Math.round(((estimatedNet * a) / 100) * 100) / 100;
    return { me, partner: Math.round((estimatedNet - me) * 100) / 100 };
  }, [
    scope,
    user?.id,
    chargeTo,
    splitSubMode,
    equalShare,
    estimatedNet,
    myAmount,
    myShares,
    partnerShares,
    myPct,
  ]);

  useEffect(() => {
    if (!isCredit) setInstallments(1);
  }, [isCredit]);

  useEffect(() => {
    if (scope === 'PERSONAL') setChargeTo('me');
  }, [scope]);

  // Seed Monto fields when entering amount split / net changes and fields are empty.
  useEffect(() => {
    if (chargeTo !== 'split' || splitSubMode !== 'AMOUNT' || estimatedNet <= 0) return;
    const half = String(Math.round((estimatedNet / 2) * 100) / 100);
    setMyAmount((prev) => (prev === '' || !Number.isFinite(Number(prev)) ? half : prev));
    setPartnerAmount((prev) => (prev === '' || !Number.isFinite(Number(prev)) ? half : prev));
  }, [chargeTo, splitSubMode, estimatedNet]);

  const splitAmountRemaining = moneyRemaining(estimatedNet, [
    parseMoneyInput(myAmount),
    parseMoneyInput(partnerAmount),
  ]);
  const canAssignSplitResto = remainingBalance(splitAmountRemaining) === 'short';

  const buildPayload = (): Omit<OutboxExpense, 'clientId' | 'createdAt'> => {
    const payload: Omit<OutboxExpense, 'clientId' | 'createdAt'> = {
      paymentMethodId: paymentMethodId!,
      categoryId: categoryId!,
      store: store.trim(),
      description: null,
      purchaseDate: `${date}T12:00:00`,
      grossAmount,
      installmentsCount: installments,
      promotionMode,
      scope,
    };
    if (promotionMode === 'manual') {
      if (manualSource === 'existing' && selectedPromotionId) {
        payload.promotionId = selectedPromotionId;
      } else if (manualSource === 'custom') {
        payload.manualDiscount = {
          label: manualLabel.trim() || null,
          discountPercentage: Number(manualPct),
          discountCap: manualCap ? Number(manualCap) : null,
        };
      }
    }
    if (scope === 'HOUSEHOLD' && members.length > 1 && user?.id && partner) {
      if (chargeTo === 'me') {
        payload.splitMode = 'ASSIGN';
        payload.assignToUserId = user.id;
      } else if (chargeTo === 'partner') {
        payload.splitMode = 'ASSIGN';
        payload.assignToUserId = partner.id;
      } else {
        const mode: SplitMode = splitSubMode;
        payload.splitMode = mode;
        if (mode === 'EQUAL') {
          // nothing else
        } else if (mode === 'AMOUNT') {
          payload.splitValues = [
            { userId: user.id, value: parseMoneyInput(myAmount) },
            { userId: partner.id, value: parseMoneyInput(partnerAmount) },
          ];
        } else if (mode === 'SHARES') {
          payload.splitValues = [
            { userId: user.id, value: Number(myShares) || 0 },
            { userId: partner.id, value: Number(partnerShares) || 0 },
          ];
        } else if (mode === 'PERCENTAGE') {
          payload.splitValues = [
            { userId: user.id, value: Number(myPct) || 0 },
            { userId: partner.id, value: Number(partnerPct) || 0 },
          ];
        }
      }
    }
    if (!methodHasOwner && paidByUserId) {
      payload.paidByUserId = paidByUserId;
    }
    return payload;
  };

  const mutation = useMutation({
    mutationFn: async () => {
      const payload = buildPayload();

      if (mode === 'edit') {
        if (!navigator.onLine) {
          throw new Error('Editar gastos requiere conexión a internet');
        }
        return api<Purchase>(`/expenses/${purchaseId}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
      }

      const createPayload: OutboxExpense = { ...payload, clientId: crypto.randomUUID(), createdAt: new Date().toISOString() };
      if (!navigator.onLine) {
        await enqueueExpense(createPayload);
        return { offline: true as const };
      }
      try {
        const purchase = await api<Purchase>('/expenses', { method: 'POST', body: JSON.stringify(createPayload) });
        return { offline: false as const, purchase };
      } catch (err) {
        if (err instanceof TypeError) {
          await enqueueExpense(createPayload);
          return { offline: true as const };
        }
        throw err;
      }
    },
    onSuccess: (result) => {
      const savedStore = store.trim();
      if (savedStore) {
        setStoreSuggestions(rememberStoreFromExpense(savedStore));
      }
      void queryClient.invalidateQueries({ queryKey: ['expenses'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      void queryClient.invalidateQueries({ queryKey: ['promotions', 'weekly', 'favorites'] });
      if (mode === 'create' && result && 'offline' in result && result.offline) {
        setSavedOffline(true);
        setTimeout(() => navigate('/gastos'), 1200);
      } else if (mode === 'edit' && purchaseId) {
        void queryClient.invalidateQueries({ queryKey: ['expenses', purchaseId] });
        navigate(`/gastos/${purchaseId}`);
      } else {
        navigate('/gastos');
      }
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'No se pudo guardar'),
  });

  const manualPromoValid =
    promotionMode !== 'manual' ||
    (manualSource === 'existing' && Boolean(selectedPromotionId)) ||
    (manualSource === 'custom' && Number(manualPct) > 0 && Number(manualPct) <= 100);

  const splitValid = (() => {
    if (scope !== 'HOUSEHOLD' || members.length < 2) return true;
    if (chargeTo === 'me' || chargeTo === 'partner') return true;
    // Repartir: partner share is always (net - mine) for Monto.
    switch (splitSubMode) {
      case 'EQUAL':
        return true;
      case 'AMOUNT':
        return remainingBalance(splitAmountRemaining) === 'ok';
      case 'SHARES':
        return Number(myShares) >= 0 && Number(partnerShares) >= 0 && Number(myShares) + Number(partnerShares) > 0;
      case 'PERCENTAGE':
        return (
          Number(myPct) >= 0 &&
          Number(partnerPct) >= 0 &&
          Math.abs(Number(myPct) + Number(partnerPct) - 100) < 0.05
        );
      default:
        return true;
    }
  })();

  const saveBlockers: string[] = [];
  if (!(grossAmount > 0)) saveBlockers.push('Ingresá el monto');
  if (!categoryId) saveBlockers.push('Elegí una categoría');
  if (!paymentMethodId) saveBlockers.push('Elegí un medio de pago');
  if (!store.trim()) saveBlockers.push('Ingresá el comercio');
  if (!manualPromoValid) {
    if (manualSource === 'existing') saveBlockers.push('Elegí una promoción');
    else saveBlockers.push('Ingresá un % de descuento válido');
  }
  if (!splitValid) saveBlockers.push('Revisá el reparto del gasto');

  const canSave = saveBlockers.length === 0 && !mutation.isPending;

  if (savedOffline) {
    return (
      <div className="page">
        <div className="offline-saved">
          <span className="big-emoji">📴</span>
          <h2>Guardado sin conexión</h2>
          <p>Se sincroniza automáticamente cuando vuelva internet.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page new-expense">
      <header className="page-header">
        <button
          className="icon-btn"
          onClick={() => {
            if (mode === 'edit' && purchaseId) navigate(`/gastos/${purchaseId}`);
            else navigate(-1);
          }}
          aria-label="Volver"
        >
          ✕
        </button>
        <h1>{title}</h1>
        <span />
      </header>

      <div className="amount-input-wrap">
        <span className="currency-sign">$</span>
        <input
          className="amount-input"
          type="number"
          inputMode="decimal"
          placeholder="0"
          autoFocus
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </div>

      <section>
        <h2 className="field-label">Tipo de gasto</h2>
        <div className="segmented">
          <button type="button" className={scope === 'HOUSEHOLD' ? 'active' : ''} onClick={() => setScope('HOUSEHOLD')}>
            Hogar
          </button>
          <button type="button" className={scope === 'PERSONAL' ? 'active' : ''} onClick={() => setScope('PERSONAL')}>
            Personal
          </button>
        </div>
        {scope === 'PERSONAL' && (
          <p className="hint">Solo vos lo ves. No suma al total del hogar ni al balance con tu pareja.</p>
        )}
      </section>

      {scope === 'HOUSEHOLD' && members.length > 1 && partner && (
        <section>
          <h2 className="field-label">Cargo a</h2>
          <div className="segmented">
            <button type="button" className={chargeTo === 'me' ? 'active' : ''} onClick={() => setChargeTo('me')}>
              Yo
            </button>
            <button
              type="button"
              className={chargeTo === 'partner' ? 'active' : ''}
              onClick={() => setChargeTo('partner')}
            >
              {partner.name}
            </button>
            <button type="button" className={chargeTo === 'split' ? 'active' : ''} onClick={() => setChargeTo('split')}>
              Repartir
            </button>
          </div>
          {chargeTo !== 'split' && estimatedNet > 0 && (
            <p className="hint">
              {chargeTo === 'me' ? 'Vos' : partner.name} asume {fmtARS.format(estimatedNet)}
            </p>
          )}

          {chargeTo === 'split' && (
            <>
              <h2 className="field-label">Cómo repartir</h2>
              <div className="segmented segmented-wrap">
                <button
                  type="button"
                  className={splitSubMode === 'EQUAL' ? 'active' : ''}
                  onClick={() => setSplitSubMode('EQUAL')}
                >
                  Igual
                </button>
                <button
                  type="button"
                  className={splitSubMode === 'AMOUNT' ? 'active' : ''}
                  onClick={() => setSplitSubMode('AMOUNT')}
                >
                  Monto
                </button>
                <button
                  type="button"
                  className={splitSubMode === 'SHARES' ? 'active' : ''}
                  onClick={() => setSplitSubMode('SHARES')}
                >
                  Partes
                </button>
                <button
                  type="button"
                  className={splitSubMode === 'PERCENTAGE' ? 'active' : ''}
                  onClick={() => setSplitSubMode('PERCENTAGE')}
                >
                  %
                </button>
              </div>

              {splitSubMode === 'EQUAL' && estimatedNet > 0 && (
                <p className="hint">
                  {fmtARS.format(equalShare)} c/u · Vos {fmtARS.format(previewShares.me)} · {partner.name}{' '}
                  {fmtARS.format(previewShares.partner)}
                </p>
              )}

              {splitSubMode === 'AMOUNT' && (
                <>
                  <div className="field-row split-fields">
                    <label>
                      Tu parte $
                      <input
                        type="number"
                        inputMode="decimal"
                        value={myAmount}
                        onChange={(e) => setMyAmount(e.target.value)}
                        placeholder={String(Math.round(equalShare))}
                      />
                      {canAssignSplitResto && (
                        <button
                          type="button"
                          className="btn-link amount-resto-btn"
                          onClick={() =>
                            setMyAmount(applyRemainingToAmount(myAmount, splitAmountRemaining))
                          }
                        >
                          Usar resto
                        </button>
                      )}
                    </label>
                    <label>
                      {partner.name} $
                      <input
                        type="number"
                        inputMode="decimal"
                        value={partnerAmount}
                        onChange={(e) => setPartnerAmount(e.target.value)}
                        placeholder={String(Math.round(equalShare))}
                      />
                      {canAssignSplitResto && (
                        <button
                          type="button"
                          className="btn-link amount-resto-btn"
                          onClick={() =>
                            setPartnerAmount(
                              applyRemainingToAmount(partnerAmount, splitAmountRemaining),
                            )
                          }
                        >
                          Usar resto
                        </button>
                      )}
                    </label>
                  </div>
                  {estimatedNet > 0 && (
                    <p
                      className={`hint ${remainingBalance(splitAmountRemaining) !== 'ok' ? 'error' : ''}`}
                    >
                      {remainingHintLabel(splitAmountRemaining)}
                      {remainingBalance(splitAmountRemaining) === 'ok'
                        ? ` · ${fmtARS.format(estimatedNet)}`
                        : ''}
                    </p>
                  )}
                </>
              )}

              {splitSubMode === 'SHARES' && (
                <div className="field-row split-fields">
                  <label>
                    Tus partes
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      value={myShares}
                      onChange={(e) => setMyShares(e.target.value)}
                    />
                  </label>
                  <label>
                    Partes {partner.name}
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      value={partnerShares}
                      onChange={(e) => setPartnerShares(e.target.value)}
                    />
                  </label>
                </div>
              )}

              {splitSubMode === 'PERCENTAGE' && (
                <div className="field-row split-fields">
                  <label>
                    Tu %
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      max="100"
                      value={myPct}
                      onChange={(e) => {
                        const v = e.target.value;
                        setMyPct(v);
                        const mine = Number(v) || 0;
                        setPartnerPct(String(Math.round((100 - mine) * 100) / 100));
                      }}
                    />
                  </label>
                  <label>
                    % {partner.name}
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      max="100"
                      value={partnerPct}
                      onChange={(e) => {
                        const v = e.target.value;
                        setPartnerPct(v);
                        const theirs = Number(v) || 0;
                        setMyPct(String(Math.round((100 - theirs) * 100) / 100));
                      }}
                    />
                  </label>
                </div>
              )}

              {chargeTo === 'split' &&
                splitSubMode !== 'EQUAL' &&
                splitSubMode !== 'AMOUNT' &&
                estimatedNet > 0 && (
                <p className="split-partner">
                  Vos {fmtARS.format(previewShares.me)} · {partner.name} {fmtARS.format(previewShares.partner)} de{' '}
                  {fmtARS.format(estimatedNet)}
                </p>
              )}
            </>
          )}
        </section>
      )}

      <section>
        <h2 className="field-label">Categoría</h2>
        <div className="category-grid">
          {categories?.map((cat) => (
            <button
              key={cat.id}
              type="button"
              className={`category-chip ${categoryId === cat.id ? 'selected' : ''}`}
              onClick={() => setCategoryId(cat.id)}
            >
              <span className="chip-icon">{cat.icon}</span>
              <span>{cat.name}</span>
            </button>
          ))}
        </div>
      </section>

      <section>
        <h2 className="field-label">Medio de pago</h2>
        {methods && methods.length === 0 && (
          <p className="hint">
            No tenés medios de pago cargados. Agregalos en <a href="/ajustes">Más</a>.
          </p>
        )}
        {(methods ? groupMethodsByEntity(methods) : []).map((group) => (
          <div key={group.entityId} className="payment-method-group">
            <span className="field-label payment-method-group-title">{group.entityName}</span>
            <div className="method-list">
              {group.items.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={`method-chip ${paymentMethodId === m.id ? 'selected' : ''}`}
                  onClick={() => setPaymentMethodId(m.id)}
                >
                  {paymentMethodDisplayName(m)}
                  {m.lastFour ? ` ···${m.lastFour}` : ''}
                  {m.owner ? ` · ${m.owner.name}` : ''}
                </button>
              ))}
            </div>
          </div>
        ))}
        {selectedMethod?.owner && (
          <p className="hint">
            Pagado por:{' '}
            <strong>
              {selectedMethod.owner.id === user?.id ? 'Vos' : selectedMethod.owner.name}
            </strong>
            <span> (dueño del medio)</span>
          </p>
        )}
        {selectedMethod && !selectedMethod.owner && members.length > 1 && (
          <div className="payer-picker">
            <h2 className="field-label">Quién pagó</h2>
            <div className="segmented">
              {members.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={paidByUserId === m.id ? 'active' : ''}
                  onClick={() => setPaidByUserId(m.id)}
                >
                  {m.id === user?.id ? 'Yo' : m.name}
                </button>
              ))}
            </div>
            <p className="hint">Este medio no tiene dueño (efectivo, transferencia, etc.).</p>
          </div>
        )}
        {selectedMethod && !selectedMethod.owner && members.length <= 1 && (
          <p className="hint">Pagado por: <strong>Vos</strong></p>
        )}
      </section>

      <section className="field-row">
        <label>
          Comercio
          <StoreAutocomplete value={store} onChange={setStore} suggestions={storeSuggestions} />
        </label>
        <label>
          Fecha
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
      </section>

      {isCredit && (
        <section>
          <h2 className="field-label">Cuotas</h2>
          <div className="method-list">
            {[1, 3, 6, 9, 12, 18].map((n) => (
              <button
                key={n}
                type="button"
                className={`method-chip ${installments === n ? 'selected' : ''}`}
                onClick={() => setInstallments(n)}
              >
                {n === 1 ? '1 pago' : `${n} cuotas`}
              </button>
            ))}
          </div>
        </section>
      )}

      {autoPromotion && best && (
        <ExpenseSuggestionPromo
          paymentMethodName={best.paymentMethodName}
          suggestion={best.suggestion}
          selected={paymentMethodId === best.paymentMethodId}
          showUseButton={paymentMethodId !== best.paymentMethodId}
          onUsePaymentMethod={() => setPaymentMethodId(best.paymentMethodId)}
        />
      )}
      {autoPromotion && store.trim() && !best && !suggestion && navigator.onLine && debouncedStore && (
        <div className="promo-banner promo-banner-offline">
          No hay promo activa hoy para {store.trim()}. Revisá el calendario en Promos o ingresá una manual.
        </div>
      )}
      {autoPromotion && paymentMethodId && best && paymentMethodId !== best.paymentMethodId && !suggestion && (
        <div className="promo-banner promo-banner-offline">
          Con {selectedMethod?.nickname ?? selectedMethod?.definition.name} no aplica ninguna promo — con{' '}
          {best.paymentMethodName} ahorrarías{' '}
          {best.suggestion.estimatedDiscount != null
            ? fmtARS.format(best.suggestion.estimatedDiscount)
            : suggestionBenefitText(best.suggestion.promotion)}
        </div>
      )}
      {autoPromotion && suggestion && !best && (
        <div className="promo-banner">
          ✨ Aplica {suggestionBenefitText(suggestion.promotion)}
          {suggestion.estimatedDiscount != null && <> — ahorrás {fmtARS.format(suggestion.estimatedDiscount)}</>}
        </div>
      )}
      {autoPromotion && suggestion && best && paymentMethodId !== best.paymentMethodId && (
        <div className="promo-banner promo-banner-offline">
          Con esta tarjeta aplica {suggestionBenefitText(suggestion.promotion)}
          {suggestion.estimatedDiscount != null && <> (ahorrás {fmtARS.format(suggestion.estimatedDiscount)})</>} — menos
          que la recomendada
        </div>
      )}
      {autoPromotion && offline && offlineSuggestion && (
        <div className="promo-banner promo-banner-offline">
          ✨ Podría aplicar {offlineSuggestion.promotion.discountPercentage}% {offlineSuggestion.promotion.entityName}
          {offlineSuggestion.estimatedDiscount != null && <> (~{fmtARS.format(offlineSuggestion.estimatedDiscount)})</>}
          <small> — se confirma al sincronizar</small>
        </div>
      )}

      <section>
        <h2 className="field-label">Promoción</h2>
        <div className="segmented">
          <button type="button" className={promotionMode === 'auto' ? 'active' : ''} onClick={() => setPromotionMode('auto')}>
            Automática
          </button>
          <button type="button" className={promotionMode === 'manual' ? 'active' : ''} onClick={() => setPromotionMode('manual')}>
            Manual
          </button>
          <button type="button" className={promotionMode === 'off' ? 'active' : ''} onClick={() => setPromotionMode('off')}>
            Sin promo
          </button>
        </div>

        {promotionMode === 'manual' && (
          <div className="manual-promo-fields">
            <div className="segmented">
              <button
                type="button"
                className={manualSource === 'existing' ? 'active' : ''}
                onClick={() => setManualSource('existing')}
              >
                Promo existente
              </button>
              <button
                type="button"
                className={manualSource === 'custom' ? 'active' : ''}
                onClick={() => setManualSource('custom')}
              >
                Ingresar descuento
              </button>
            </div>

            {manualSource === 'existing' ? (
              <label>
                Promoción
                <select
                  value={selectedPromotionId ?? ''}
                  onChange={(e) => setSelectedPromotionId(e.target.value || null)}
                >
                  <option value="">Elegí una promoción…</option>
                  {selectablePromos.map((p) => (
                    <option key={p.id} value={p.id}>
                      {promotionOptionLabel(p, categories)}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <>
                <label>
                  Etiqueta (opcional)
                  <input
                    value={manualLabel}
                    onChange={(e) => setManualLabel(e.target.value)}
                    placeholder="App YPF, Combustible…"
                  />
                </label>
                <div className="field-row">
                  <label>
                    Descuento %
                    <input
                      type="number"
                      min="1"
                      max="100"
                      inputMode="decimal"
                      value={manualPct}
                      onChange={(e) => setManualPct(e.target.value)}
                      placeholder="10"
                    />
                  </label>
                  <label>
                    Tope $
                    <input
                      type="number"
                      min="0"
                      inputMode="decimal"
                      value={manualCap}
                      onChange={(e) => setManualCap(e.target.value)}
                      placeholder="4000"
                    />
                  </label>
                </div>
                <p className="hint">El tope es el máximo de descuento aplicable (mensual o por compra).</p>
              </>
            )}

            {manualDiscountPreview && manualDiscountPreview.discountAmount > 0 && (
              <div className="promo-banner">
                ✨ Descuento estimado: {fmtARS.format(manualDiscountPreview.discountAmount)} — pagás{' '}
                {fmtARS.format(manualDiscountPreview.netAmount)}
              </div>
            )}
          </div>
        )}
      </section>

      {error && <p className="error">{error}</p>}
      {saveBlockers.length > 0 && !mutation.isPending && (
        <p className="hint center">{saveBlockers.join(' · ')}</p>
      )}

      <button className="btn-primary btn-save" disabled={!canSave} onClick={() => mutation.mutate()}>
        {mutation.isPending ? 'Guardando…' : mode === 'edit' ? 'Guardar cambios' : 'Guardar gasto'}
      </button>
    </div>
  );
}

export { initialFromPurchase };
