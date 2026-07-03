import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { findCandidatePromotions, calculateDiscount } from '@biko/shared';
import StoreAutocomplete from './StoreAutocomplete';
import ExpenseSuggestionPromo, { suggestionBenefitText } from './ExpenseSuggestionPromo';
import { api, fmtARS } from '../lib/api';
import { useAuth } from '../lib/auth';
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
  Suggestion,
} from '../lib/types';

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
  splitMode: 'equal' | 'custom';
  myShare: string;
}

function initialFromPurchase(purchase: Purchase, userId: string): ExpenseFormInitial {
  const promoState = resolvePromotionStateFromPurchase(purchase);
  const myAllocation = purchase.allocations.find((a) => a.userId === userId);
  const netAmount = Number(purchase.netAmount);
  const memberCount = purchase.allocations.length;
  const equalShare = memberCount > 0 ? netAmount / memberCount : netAmount;
  const myAmount = myAllocation ? Number(myAllocation.amount) : equalShare;
  const isEqual =
    purchase.scope === 'HOUSEHOLD' &&
    purchase.allocations.every((a) => Math.abs(Number(a.amount) - equalShare) < 0.02);

  return {
    amount: String(Number(purchase.grossAmount)),
    categoryId: purchase.category.id,
    paymentMethodId: purchase.paymentMethod.id,
    store: purchase.store,
    date: purchaseDateToISO(purchase.purchaseDate),
    installments: purchase.installmentsCount,
    ...promoState,
    scope: purchase.scope,
    splitMode: purchase.scope === 'PERSONAL' || isEqual ? 'equal' : 'custom',
    myShare: String(Math.round(myAmount)),
  };
}

interface ExpenseFormProps {
  mode: 'create' | 'edit';
  purchaseId?: string;
  initial?: ExpenseFormInitial;
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
  const [splitMode, setSplitMode] = useState<'equal' | 'custom'>(initial?.splitMode ?? 'equal');
  const [myShare, setMyShare] = useState(initial?.myShare ?? '');
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
  const grossAmount = Number(amount) || 0;

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
  const myShareAmount = splitMode === 'custom' && scope === 'HOUSEHOLD' ? Number(myShare) || 0 : equalShare;
  const partnerShare = scope === 'HOUSEHOLD' ? Math.max(0, estimatedNet - myShareAmount) : 0;

  useEffect(() => {
    if (!isCredit) setInstallments(1);
  }, [isCredit]);

  useEffect(() => {
    if (scope === 'PERSONAL') setSplitMode('equal');
  }, [scope]);

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
    if (scope === 'HOUSEHOLD' && splitMode === 'custom' && myShareAmount > 0) {
      payload.myShareAmount = myShareAmount;
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
      if (mode === 'create' && result && 'offline' in result && result.offline) {
        setSavedOffline(true);
        setTimeout(() => navigate('/gastos'), 1200);
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

  const canSave =
    grossAmount > 0 &&
    categoryId &&
    paymentMethodId &&
    store.trim() &&
    !mutation.isPending &&
    manualPromoValid &&
    (scope !== 'HOUSEHOLD' || splitMode !== 'custom' || (myShareAmount > 0 && myShareAmount <= estimatedNet));

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
        <button className="icon-btn" onClick={() => navigate(-1)} aria-label="Volver">
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
          <p className="hint">No suma al total del hogar; solo aparece en tu desglose personal.</p>
        )}
      </section>

      {scope === 'HOUSEHOLD' && members.length > 1 && (
        <section>
          <h2 className="field-label">Reparto</h2>
          <div className="segmented">
            <button type="button" className={splitMode === 'equal' ? 'active' : ''} onClick={() => setSplitMode('equal')}>
              Reparto igual
            </button>
            <button type="button" className={splitMode === 'custom' ? 'active' : ''} onClick={() => setSplitMode('custom')}>
              Mi parte custom
            </button>
          </div>
          {splitMode === 'equal' && estimatedNet > 0 && (
            <p className="hint">
              {fmtARS.format(equalShare)} por persona ({members.length} miembros)
            </p>
          )}
          {splitMode === 'custom' && (
            <div className="field-row split-fields">
              <label>
                Mi parte
                <input
                  type="number"
                  inputMode="decimal"
                  value={myShare}
                  onChange={(e) => setMyShare(e.target.value)}
                  placeholder={String(Math.round(equalShare))}
                />
              </label>
              {partner && estimatedNet > 0 && (
                <p className="split-partner">
                  {partner.name}: {fmtARS.format(partnerShare)} de {fmtARS.format(estimatedNet)}
                </p>
              )}
            </div>
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
            No tenés medios de pago cargados. Agregalos en <a href="/ajustes">Ajustes</a>.
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
                </button>
              ))}
            </div>
          </div>
        ))}
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

      <button className="btn-primary btn-save" disabled={!canSave} onClick={() => mutation.mutate()}>
        {mutation.isPending ? 'Guardando…' : mode === 'edit' ? 'Guardar cambios' : 'Guardar gasto'}
      </button>
    </div>
  );
}

export { initialFromPurchase };
