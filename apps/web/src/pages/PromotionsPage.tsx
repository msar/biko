import { dayOfWeekFromDate, DISCOUNT_KIND_LABEL, filterWeeklyByFavorites, type DiscountKind } from '@biko/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, DAY_LABEL } from '../lib/api';
import {
  groupWeeklyPromos,
  promotionToWeeklyPromo,
  TodayPromos,
  WeeklyDayCard,
  WeeklyPromoGroupCard,
  type WeeklyPromoGroup,
} from '../lib/weekly-promo-display';
import type {
  Category,
  CategorySchedule,
  DayRecommendation,
  Entity,
  FavoriteWeeklyPromo,
  HiddenWeeklyPromo,
  Promotion,
} from '../lib/types';

const DAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'] as const;

const DISCOUNT_KINDS: DiscountKind[] = ['PERCENTAGE_REFUND', 'INSTALLMENTS', 'FIXED_AMOUNT', 'OTHER'];

function normalizeSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toLowerCase();
}

function promoMatchesSearch(
  promo: Promotion,
  query: string,
  categoryNamesById: Map<string, string>,
): boolean {
  const q = normalizeSearch(query);
  if (!q) return true;

  const haystack = [
    promo.store,
    promo.discountLabel,
    promo.sponsorBank,
    ...promo.sponsorBanks,
    promo.entity?.name,
    ...promo.categoryIds.map((id) => categoryNamesById.get(id)),
    ...promo.details,
  ]
    .filter(Boolean)
    .map((value) => normalizeSearch(String(value)))
    .join(' ');

  return haystack.includes(q);
}

function WeeklyCalendar({
  weekly,
  province,
  hiddenPromos,
  onHideGroup,
  onUnhideGroup,
  onToggleFavorite,
  favoriteKeys,
}: {
  weekly: DayRecommendation[] | undefined;
  province: string | null | undefined;
  hiddenPromos: HiddenWeeklyPromo[] | undefined;
  onHideGroup: (group: WeeklyPromoGroup) => void;
  onUnhideGroup: (groupKey: string) => void;
  onToggleFavorite: (group: WeeklyPromoGroup) => void;
  favoriteKeys: ReadonlySet<string>;
}) {
  const [showHidden, setShowHidden] = useState(false);
  const favoriteDays = useMemo(
    () => (weekly ? filterWeeklyByFavorites(weekly, favoriteKeys) : []),
    [weekly, favoriteKeys],
  );

  return (
    <div className="week-calendar">
      <p className="hint">
        Tus promos favoritas, día por día. Marcá con ★ desde Hoy, ¿Cuándo ir? o Todas.
        {province && ` Filtrado para ${province}.`}
      </p>
      {(hiddenPromos?.length ?? 0) > 0 && (
        <div className="week-hidden-bar">
          <button type="button" className="btn-link" onClick={() => setShowHidden(!showHidden)}>
            {showHidden ? 'Ocultar lista' : `Ver ocultas (${hiddenPromos!.length})`}
          </button>
        </div>
      )}
      {showHidden && hiddenPromos && hiddenPromos.length > 0 && (
        <div className="card week-hidden-list">
          <h4>Promos ocultas en Mi semana</h4>
          <ul className="week-hidden-items">
            {hiddenPromos.map((item) => (
              <li key={item.groupKey}>
                <span>{item.label}</span>
                <button type="button" className="btn-link" onClick={() => onUnhideGroup(item.groupKey)}>
                  Mostrar
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {favoriteKeys.size === 0 && (
        <p className="empty-state">
          Todavía no tenés favoritas. Marcá promos con ★ en Hoy, ¿Cuándo ir? o Todas para armar tu semana.
        </p>
      )}
      {favoriteKeys.size > 0 && favoriteDays.length === 0 && (
        <p className="empty-state">
          Tus favoritas no aplican esta semana con tus medios de pago. Probá otras o revisá Ajustes.
        </p>
      )}
      {favoriteDays.map((day) => (
        <WeeklyDayCard
          key={day.dayOfWeek}
          day={day}
          onHideGroup={onHideGroup}
          onToggleFavorite={onToggleFavorite}
          favoriteKeys={favoriteKeys}
          cap={Number.POSITIVE_INFINITY}
        />
      ))}
    </div>
  );
}

function WhenToGo({
  categories,
  onToggleFavorite,
  favoriteKeys,
}: {
  categories: Category[];
  onToggleFavorite: (group: WeeklyPromoGroup) => void;
  favoriteKeys: ReadonlySet<string>;
}) {
  const [categoryId, setCategoryId] = useState<string | null>(null);

  // Solo rubros globales (seed): ¿Cuándo ir? es para compras tipificadas (combustible, super…).
  const shoppingCategories = useMemo(
    () => categories.filter((cat) => cat.householdId == null),
    [categories],
  );

  const { data: schedule, isLoading, isFetching } = useQuery({
    queryKey: ['promotions', 'by-category', categoryId],
    queryFn: () => api<CategorySchedule>(`/promotions/by-category/${categoryId}`),
    enabled: Boolean(categoryId),
  });

  return (
    <>
      <p className="hint">Elegí un rubro y te ordenamos los días por mejor descuento.</p>
      <div className="category-grid">
        {shoppingCategories.map((cat) => (
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

      {categoryId && (isLoading || isFetching) && <p className="hint">Buscando mejores días…</p>}

      {categoryId && schedule && schedule.days.length === 0 && !isLoading && !isFetching && (
        <p className="empty-state">
          Sin promos de {schedule.category.name} para tus medios de pago. Probá cargar una promo manualmente.
        </p>
      )}

      {schedule?.days.map((day, idx) => (
        <div key={day.dayOfWeek} className={`card when-day ${idx === 0 ? 'best' : ''}`}>
          <div className="when-day-head">
            <strong>{DAY_LABEL[day.dayOfWeek]}</strong>
            <span className="when-day-discount">hasta {day.bestDiscount}%</span>
            {idx === 0 && <span className="badge-best">Mejor día</span>}
          </div>
          {groupWeeklyPromos(day.promotions).map((group) => (
            <WeeklyPromoGroupCard
              key={group.key}
              group={group}
              favorited={favoriteKeys.has(group.key)}
              onToggleFavorite={onToggleFavorite}
            />
          ))}
        </div>
      ))}
    </>
  );
}

function PromoForm({
  entities,
  categories,
  onDone,
}: {
  entities: Entity[];
  categories: Category[];
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState<string[]>([]);
  const [categoryIds, setCategoryIds] = useState<string[]>([]);

  const mutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api('/promotions', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['promotions'] });
      onDone();
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Error'),
  });

  const toggle = (list: string[], value: string, set: (v: string[]) => void) =>
    set(list.includes(value) ? list.filter((x) => x !== value) : [...list, value]);

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    mutation.mutate({
      entityId: String(data.get('entityId')),
      store: String(data.get('store')) || null,
      daysOfWeek: days,
      categoryIds,
      discountPercentage: Number(data.get('discountPercentage')),
      discountCap: data.get('discountCap') ? Number(data.get('discountCap')) : null,
      notes: String(data.get('notes')) || null,
    });
  };

  return (
    <form className="card promo-form" onSubmit={onSubmit}>
      <h2>Nueva promoción</h2>
      <label>
        Entidad
        <select name="entityId" required>
          {entities.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Comercio (vacío = cualquiera)
        <input name="store" placeholder="ChangoMás" />
      </label>
      <span className="field-label">Días (ninguno = todos los días)</span>
      <div className="method-list">
        {DAYS.map((d) => (
          <button
            key={d}
            type="button"
            className={`method-chip ${days.includes(d) ? 'selected' : ''}`}
            onClick={() => toggle(days, d, setDays)}
          >
            {DAY_LABEL[d]}
          </button>
        ))}
      </div>
      <span className="field-label">Rubros (ninguno = cualquiera)</span>
      <div className="method-list">
        {categories.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`method-chip ${categoryIds.includes(c.id) ? 'selected' : ''}`}
            onClick={() => toggle(categoryIds, c.id, setCategoryIds)}
          >
            {c.icon} {c.name}
          </button>
        ))}
      </div>
      <div className="field-row">
        <label>
          Descuento %
          <input name="discountPercentage" type="number" min="1" max="100" required />
        </label>
        <label>
          Tope mensual $
          <input name="discountCap" type="number" min="0" placeholder="Sin tope" />
        </label>
      </div>
      <label>
        Notas
        <input name="notes" placeholder="Pagando con app del banco…" />
      </label>
      {error && <p className="error">{error}</p>}
      <button className="btn-primary" disabled={mutation.isPending}>
        Guardar promo
      </button>
    </form>
  );
}

export default function PromotionsPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'hoy' | 'calendar' | 'when' | 'all'>('hoy');
  const [showForm, setShowForm] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCategory, setFilterCategory] = useState<string | null>(null);
  const [filterEntity, setFilterEntity] = useState<string | null>(null);
  const [filterDiscountKind, setFilterDiscountKind] = useState<DiscountKind | null>(null);
  const [filterSource, setFilterSource] = useState<'all' | 'MANUAL' | 'SCRAPED'>('all');
  const [activeOnly, setActiveOnly] = useState(true);
  const [filterPaymentFlow, setFilterPaymentFlow] = useState<'all' | 'instore' | 'online'>('all');

  const today = dayOfWeekFromDate(new Date());

  const { data: me } = useQuery({
    queryKey: ['me'],
    queryFn: () =>
      api<{ household: { province: string | null; bankPrograms: string[] } }>('/auth/me'),
  });

  const { data: weekly } = useQuery({
    queryKey: ['promotions', 'weekly', me?.household.province, me?.household.bankPrograms],
    queryFn: () => api<DayRecommendation[]>('/promotions/weekly'),
  });

  const { data: hiddenPromos } = useQuery({
    queryKey: ['promotions', 'weekly', 'hidden'],
    queryFn: () => api<HiddenWeeklyPromo[]>('/promotions/weekly/hidden'),
  });

  const { data: favoritePromos } = useQuery({
    queryKey: ['promotions', 'weekly', 'favorites'],
    queryFn: () => api<FavoriteWeeklyPromo[]>('/promotions/weekly/favorites'),
  });

  const favoriteKeys = useMemo(
    () => new Set(favoritePromos?.map((f) => f.groupKey) ?? []),
    [favoritePromos],
  );

  const hideGroup = useMutation({
    mutationFn: (group: { key: string; label: string }) =>
      api<HiddenWeeklyPromo>('/promotions/weekly/hidden', {
        method: 'POST',
        body: JSON.stringify({ groupKey: group.key, label: group.label }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['promotions', 'weekly'] });
      void queryClient.invalidateQueries({ queryKey: ['promotions', 'weekly', 'hidden'] });
    },
  });

  const unhideGroup = useMutation({
    mutationFn: (groupKey: string) =>
      api(`/promotions/weekly/hidden/${encodeURIComponent(groupKey)}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['promotions', 'weekly'] });
      void queryClient.invalidateQueries({ queryKey: ['promotions', 'weekly', 'hidden'] });
    },
  });

  const favoriteGroup = useMutation({
    mutationFn: (group: { key: string; label: string }) =>
      api<FavoriteWeeklyPromo>('/promotions/weekly/favorites', {
        method: 'POST',
        body: JSON.stringify({ groupKey: group.key, label: group.label }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['promotions', 'weekly', 'favorites'] });
    },
  });

  const unfavoriteGroup = useMutation({
    mutationFn: (groupKey: string) =>
      api(`/promotions/weekly/favorites/${encodeURIComponent(groupKey)}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['promotions', 'weekly', 'favorites'] });
    },
  });

  const onHideGroup = (group: WeeklyPromoGroup) =>
    hideGroup.mutate({ key: group.key, label: group.label });

  const onToggleFavorite = (group: WeeklyPromoGroup) => {
    if (favoriteKeys.has(group.key)) {
      unfavoriteGroup.mutate(group.key);
    } else {
      favoriteGroup.mutate({ key: group.key, label: group.label });
    }
  };

  const { data: promotions } = useQuery({
    queryKey: ['promotions'],
    queryFn: () => api<Promotion[]>('/promotions'),
  });
  const { data: entities } = useQuery({
    queryKey: ['catalog', 'entities'],
    queryFn: () => api<Entity[]>('/catalog/entities'),
  });
  const { data: categories } = useQuery({
    queryKey: ['categories'],
    queryFn: () => api<Category[]>('/categories'),
  });

  const deactivate = async (id: string) => {
    await api(`/promotions/${id}`, { method: 'DELETE' });
    void queryClient.invalidateQueries({ queryKey: ['promotions'] });
  };

  const categoryNamesById = useMemo(() => {
    const map = new Map<string, string>();
    for (const cat of categories ?? []) map.set(cat.id, cat.name);
    return map;
  }, [categories]);

  const trimmedSearch = searchQuery.trim();

  const visiblePromos =
    promotions?.filter((p) => {
      if (activeOnly && !p.active) return false;
      if (filterSource !== 'all' && p.source !== filterSource) return false;
      if (filterEntity && p.entityId !== filterEntity) return false;
      if (filterCategory && p.categoryIds.length > 0 && !p.categoryIds.includes(filterCategory)) return false;
      if (filterDiscountKind && p.discountKind !== filterDiscountKind) return false;
      if (filterPaymentFlow !== 'all') {
        if (p.paymentFlow !== filterPaymentFlow) return false;
      }
      if (!promoMatchesSearch(p, trimmedSearch, categoryNamesById)) return false;
      return true;
    }) ?? [];

  const catalogGroups = useMemo(
    () => groupWeeklyPromos(visiblePromos.map(promotionToWeeklyPromo)),
    [visiblePromos],
  );

  const onSearchChange = (value: string) => {
    setSearchQuery(value);
    if (value.trim()) setTab('all');
  };

  return (
    <div className="page">
      <header className="page-header">
        <h1>Promociones</h1>
        <button className="icon-btn" onClick={() => setShowForm(!showForm)} aria-label="Agregar promo">
          {showForm ? '✕' : '＋'}
        </button>
      </header>

      {showForm && entities && categories && (
        <PromoForm entities={entities} categories={categories} onDone={() => setShowForm(false)} />
      )}

      <div className="promo-search">
        <input
          type="search"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Buscar comercio, banco…"
          aria-label="Buscar promociones"
        />
        {trimmedSearch && (
          <button type="button" className="promo-search-clear" onClick={() => setSearchQuery('')} aria-label="Limpiar búsqueda">
            ✕
          </button>
        )}
      </div>

      <div className="segmented">
        <button className={tab === 'hoy' ? 'active' : ''} onClick={() => setTab('hoy')}>
          Hoy
        </button>
        <button className={tab === 'calendar' ? 'active' : ''} onClick={() => setTab('calendar')}>
          Mi semana
        </button>
        <button className={tab === 'when' ? 'active' : ''} onClick={() => setTab('when')}>
          ¿Cuándo ir?
        </button>
        <button className={tab === 'all' ? 'active' : ''} onClick={() => setTab('all')}>
          Todas
        </button>
      </div>

      {tab === 'hoy' && (
        <>
          <div className="filter-block">
            <span className="field-label">Canal</span>
            <div className="segmented">
              <button
                className={filterPaymentFlow === 'all' ? 'active' : ''}
                onClick={() => setFilterPaymentFlow('all')}
              >
                Todos
              </button>
              <button
                className={filterPaymentFlow === 'instore' ? 'active' : ''}
                onClick={() => setFilterPaymentFlow('instore')}
              >
                Presencial
              </button>
              <button
                className={filterPaymentFlow === 'online' ? 'active' : ''}
                onClick={() => setFilterPaymentFlow('online')}
              >
                Online
              </button>
            </div>
          </div>
          <TodayPromos
            weekly={
              filterPaymentFlow === 'all'
                ? weekly
                : weekly?.map((day) => ({
                    ...day,
                    promotions: day.promotions.filter((p) => p.paymentFlow === filterPaymentFlow),
                  }))
            }
            today={today}
            onHideGroup={onHideGroup}
            onToggleFavorite={onToggleFavorite}
            favoriteKeys={favoriteKeys}
          />
        </>
      )}

      {tab === 'calendar' && (
        <WeeklyCalendar
          weekly={weekly}
          province={me?.household.province}
          hiddenPromos={hiddenPromos}
          onHideGroup={onHideGroup}
          onUnhideGroup={(groupKey) => unhideGroup.mutate(groupKey)}
          onToggleFavorite={onToggleFavorite}
          favoriteKeys={favoriteKeys}
        />
      )}

      {tab === 'when' && categories && (
        <WhenToGo categories={categories} onToggleFavorite={onToggleFavorite} favoriteKeys={favoriteKeys} />
      )}

      {tab === 'all' && (
        <>
          <div className="filter-block">
            <span className="field-label">Tipo de descuento</span>
            <div className="method-list">
              <button
                className={`method-chip ${filterDiscountKind === null ? 'selected' : ''}`}
                onClick={() => setFilterDiscountKind(null)}
              >
                Todos
              </button>
              {DISCOUNT_KINDS.map((kind) => (
                <button
                  key={kind}
                  className={`method-chip ${filterDiscountKind === kind ? 'selected' : ''}`}
                  onClick={() => setFilterDiscountKind(filterDiscountKind === kind ? null : kind)}
                >
                  {DISCOUNT_KIND_LABEL[kind]}
                </button>
              ))}
            </div>
          </div>
          <div className="filter-block">
            <span className="field-label">Canal</span>
            <div className="segmented">
              <button
                className={filterPaymentFlow === 'all' ? 'active' : ''}
                onClick={() => setFilterPaymentFlow('all')}
              >
                Todos
              </button>
              <button
                className={filterPaymentFlow === 'instore' ? 'active' : ''}
                onClick={() => setFilterPaymentFlow('instore')}
              >
                Presencial
              </button>
              <button
                className={filterPaymentFlow === 'online' ? 'active' : ''}
                onClick={() => setFilterPaymentFlow('online')}
              >
                Online
              </button>
            </div>
          </div>
          <div className="filter-block">
            <span className="field-label">Ubicación</span>
            {me?.household.province ? (
              <p className="hint">
                Filtrando por tu provincia ({me.household.province}). Cambiála en{' '}
                <Link to="/ajustes">Ajustes</Link>.
              </p>
            ) : (
              <p className="hint">
                Configurá tu provincia en <Link to="/ajustes">Ajustes</Link> para ocultar promos de otras zonas.
              </p>
            )}
          </div>
          <div className="filter-block">
            <span className="field-label">Rubro</span>
            <div className="method-list">
              <button
                className={`method-chip ${filterCategory === null ? 'selected' : ''}`}
                onClick={() => setFilterCategory(null)}
              >
                Todos
              </button>
              {categories?.map((c) => (
                <button
                  key={c.id}
                  className={`method-chip ${filterCategory === c.id ? 'selected' : ''}`}
                  onClick={() => setFilterCategory(filterCategory === c.id ? null : c.id)}
                >
                  {c.icon} {c.name}
                </button>
              ))}
            </div>
          </div>
          <div className="filter-block">
            <span className="field-label">Entidad</span>
            <div className="method-list">
              <button
                className={`method-chip ${filterEntity === null ? 'selected' : ''}`}
                onClick={() => setFilterEntity(null)}
              >
                Todas
              </button>
              {entities?.map((e) => (
                <button
                  key={e.id}
                  className={`method-chip ${filterEntity === e.id ? 'selected' : ''}`}
                  onClick={() => setFilterEntity(filterEntity === e.id ? null : e.id)}
                >
                  {e.name}
                </button>
              ))}
            </div>
          </div>
          <div className="filter-block">
            <span className="field-label">Origen</span>
            <div className="segmented">
              <button className={filterSource === 'all' ? 'active' : ''} onClick={() => setFilterSource('all')}>
                Todas
              </button>
              <button className={filterSource === 'MANUAL' ? 'active' : ''} onClick={() => setFilterSource('MANUAL')}>
                Manuales
              </button>
              <button className={filterSource === 'SCRAPED' ? 'active' : ''} onClick={() => setFilterSource('SCRAPED')}>
                MODO
              </button>
            </div>
            <label className="toggle-row">
              <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} />
              Solo activas
            </label>
          </div>
          {catalogGroups.length > 0 ? (
            <div className="week-day card">
              {catalogGroups.map((group) => (
                <WeeklyPromoGroupCard
                  key={group.key}
                  group={group}
                  onDeactivate={(id) => void deactivate(id)}
                  favorited={favoriteKeys.has(group.key)}
                  onToggleFavorite={onToggleFavorite}
                />
              ))}
            </div>
          ) : (
            <p className="empty-state">
              {trimmedSearch
                ? `Sin resultados para “${trimmedSearch}”.`
                : 'Sin promos que coincidan con los filtros.'}
            </p>
          )}
        </>
      )}
    </div>
  );
}
