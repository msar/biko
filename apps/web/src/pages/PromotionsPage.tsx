import { dayOfWeekFromDate, DISCOUNT_KIND_LABEL, type DiscountKind } from '@biko/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useMemo, useState } from 'react';
import { api, DAY_LABEL } from '../lib/api';
import { filterPromosByLocation } from '../lib/promo-display';
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
  const activeDays = weekly?.filter((day) => day.promotions.length > 0) ?? [];

  return (
    <div className="week-calendar">
      <p className="hint">
        Compras frecuentes del hogar: super, verdulería, combustible, farmacia… Solo promos de tus bancos.
        Cada promo tiene link a MODO para ver condiciones (ej. compra mínima).
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
      {activeDays.length === 0 && (
        <p className="empty-state">
          Sin promos de compras frecuentes para tus bancos. Agregá tus tarjetas en Ajustes.
        </p>
      )}
      {activeDays.map((day) => (
        <WeeklyDayCard
          key={day.dayOfWeek}
          day={day}
          onHideGroup={onHideGroup}
          onToggleFavorite={onToggleFavorite}
          favoriteKeys={favoriteKeys}
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

  const { data: schedule, isLoading } = useQuery({
    queryKey: ['promotions', 'by-category', categoryId],
    queryFn: () => api<CategorySchedule>(`/promotions/by-category/${categoryId}`),
    enabled: Boolean(categoryId),
  });

  return (
    <>
      <p className="hint">Elegí qué querés comprar y te decimos qué día conviene.</p>
      <div className="category-grid">
        {categories.map((cat) => (
          <button
            key={cat.id}
            className={`category-chip ${categoryId === cat.id ? 'selected' : ''}`}
            onClick={() => setCategoryId(cat.id)}
          >
            <span className="chip-icon">{cat.icon}</span>
            <span>{cat.name}</span>
          </button>
        ))}
      </div>

      {categoryId && schedule && schedule.days.length === 0 && !isLoading && (
        <p className="empty-state">
          Sin promos de {schedule.category.name} para tus medios de pago. Probá cargar una promo manualmente.
        </p>
      )}

      {schedule?.days.map((day, idx) => (
        <div key={day.dayOfWeek} className={`card when-day ${idx === 0 ? 'best' : ''}`}>
          <div className="when-day-head">
            <strong>{DAY_LABEL[day.dayOfWeek]}</strong>
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
  const [filterCategory, setFilterCategory] = useState<string | null>(null);
  const [filterEntity, setFilterEntity] = useState<string | null>(null);
  const [filterDiscountKind, setFilterDiscountKind] = useState<DiscountKind | null>(null);
  const [filterSource, setFilterSource] = useState<'all' | 'MANUAL' | 'SCRAPED'>('all');
  const [activeOnly, setActiveOnly] = useState(true);
  const [locationFilter, setLocationFilter] = useState<'household' | 'all'>('household');

  const today = dayOfWeekFromDate(new Date());

  const { data: me } = useQuery({
    queryKey: ['me'],
    queryFn: () => api<{ household: { province: string | null } }>('/auth/me'),
  });

  const { data: weekly } = useQuery({
    queryKey: ['promotions', 'weekly', me?.household.province],
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

  const visiblePromos = filterPromosByLocation(
    promotions?.filter((p) => {
      if (activeOnly && !p.active) return false;
      if (filterSource !== 'all' && p.source !== filterSource) return false;
      if (filterEntity && p.entityId !== filterEntity) return false;
      if (filterCategory && p.categoryIds.length > 0 && !p.categoryIds.includes(filterCategory)) return false;
      if (filterDiscountKind && p.discountKind !== filterDiscountKind) return false;
      return true;
    }) ?? [],
    locationFilter === 'household' ? (me?.household.province ?? null) : null,
  );

  const catalogGroups = useMemo(
    () => groupWeeklyPromos(visiblePromos.map(promotionToWeeklyPromo)),
    [visiblePromos],
  );

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
        <TodayPromos
          weekly={weekly}
          today={today}
          onHideGroup={onHideGroup}
          onToggleFavorite={onToggleFavorite}
          favoriteKeys={favoriteKeys}
        />
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
            <span className="field-label">Ubicación</span>
            <div className="segmented">
              <button
                className={locationFilter === 'household' ? 'active' : ''}
                onClick={() => setLocationFilter('household')}
              >
                {me?.household.province ? `Mi zona (${me.household.province})` : 'Configurar en Ajustes'}
              </button>
              <button className={locationFilter === 'all' ? 'active' : ''} onClick={() => setLocationFilter('all')}>
                Todo el país
              </button>
            </div>
            {!me?.household.province && locationFilter === 'household' && (
              <small className="hint">Elegí tu provincia en Ajustes para ocultar promos de otras zonas.</small>
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
            <p className="empty-state">Sin promos que coincidan con los filtros.</p>
          )}
        </>
      )}
    </div>
  );
}
