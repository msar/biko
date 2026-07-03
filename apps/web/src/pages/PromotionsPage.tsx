import { ARGENTINE_PROVINCES, DISCOUNT_KIND_LABEL, type DiscountKind } from '@biko/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { api, DAY_LABEL, fmtARS, formatDays } from '../lib/api';
import { filterPromosByLocation, PromoCard } from '../lib/promo-display';
import { groupWeeklyPromos, WeeklyPromoGroupCard } from '../lib/weekly-promo-display';
import { storeDisplayName } from '../lib/store-brands';
import type {
  Category,
  CategorySchedule,
  DayRecommendation,
  Entity,
  HiddenWeeklyPromo,
  Promotion,
  PromotionSyncStatus,
} from '../lib/types';

const DAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'] as const;

const DISCOUNT_KINDS: DiscountKind[] = ['PERCENTAGE_REFUND', 'INSTALLMENTS', 'FIXED_AMOUNT', 'OTHER'];

const WEEKLY_PROMO_CAP = 5;

function WeeklyDayCard({
  day,
  onHideGroup,
}: {
  day: DayRecommendation;
  onHideGroup: (group: ReturnType<typeof groupWeeklyPromos>[number]) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const groups = groupWeeklyPromos(day.promotions);
  const visible = expanded ? groups : groups.slice(0, WEEKLY_PROMO_CAP);
  const hiddenCount = groups.length - WEEKLY_PROMO_CAP;

  return (
    <div className="week-day card">
      <h3>{DAY_LABEL[day.dayOfWeek]}</h3>
      {visible.map((group) => (
        <WeeklyPromoGroupCard key={group.key} group={group} onHide={onHideGroup} />
      ))}
      {!expanded && hiddenCount > 0 && (
        <button type="button" className="btn-link week-promo-more" onClick={() => setExpanded(true)}>
          Ver {hiddenCount} más
        </button>
      )}
    </div>
  );
}

function WeeklyCalendar() {
  const queryClient = useQueryClient();
  const [showHidden, setShowHidden] = useState(false);
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

  const activeDays = weekly?.filter((day) => day.promotions.length > 0) ?? [];

  return (
    <div className="week-calendar">
      <p className="hint">
        Compras frecuentes del hogar: super, verdulería, combustible, farmacia… Solo promos de tus bancos.
        Cada promo tiene link a MODO para ver condiciones (ej. compra mínima).
        {me?.household.province && ` Filtrado para ${me.household.province}.`}
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
                <button
                  type="button"
                  className="btn-link"
                  onClick={() => unhideGroup.mutate(item.groupKey)}
                  disabled={unhideGroup.isPending}
                >
                  Mostrar
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {activeDays.length === 0 && (
        <p className="empty-state">
          Sin promos de compras frecuentes para tus bancos. Agregá tus tarjetas en Ajustes o sincronizá MODO.
        </p>
      )}
      {activeDays.map((day) => (
        <WeeklyDayCard
          key={day.dayOfWeek}
          day={day}
          onHideGroup={(group) => hideGroup.mutate({ key: group.key, label: group.label })}
        />
      ))}
    </div>
  );
}

// "¿Cuándo ir?": elegís una categoría y te dice qué días conviene comprar.
function WhenToGo({ categories }: { categories: Category[] }) {
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
          Sin promos de {schedule.category.name} para tus medios de pago. Probá sincronizar MODO o cargá una promo.
        </p>
      )}

      {schedule?.days.map((day, idx) => (
        <div key={day.dayOfWeek} className={`card when-day ${idx === 0 ? 'best' : ''}`}>
          <div className="when-day-head">
            <strong>{DAY_LABEL[day.dayOfWeek]}</strong>
            {idx === 0 && <span className="badge-best">Mejor día</span>}
          </div>
          {day.promotions.map((p) => (
            <div key={p.promotionId} className="week-promo">
              <strong>{p.discountPercentage}%</strong> {p.entityName}
              <small>
                {storeDisplayName(p.store)}
                {p.discountCap ? ` · tope ${fmtARS.format(p.discountCap)}` : ''}
                {p.minPurchaseAmount ? ` · mín. ${fmtARS.format(p.minPurchaseAmount)}` : ''}
              </small>
              {p.sourceUrl && (
                <a className="week-promo-details-link" href={p.sourceUrl} target="_blank" rel="noreferrer">
                  Ver detalles en MODO
                </a>
              )}
            </div>
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

function SyncModoButton() {
  const queryClient = useQueryClient();
  const { data: statuses } = useQuery({
    queryKey: ['promotions', 'sync-status'],
    queryFn: () => api<PromotionSyncStatus[]>('/promotions/sync/status'),
  });
  const modo = statuses?.find((s) => s.source === 'MODO');

  const sync = useMutation({
    mutationFn: () =>
      api<{ imported: number; updated: number; deactivated: number; cleared?: number }>(
        '/promotions/sync/modo?fresh=1',
        { method: 'POST' },
      ),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['promotions'] });
    },
  });

  return (
    <div className="sync-row">
      <button className="btn-link" onClick={() => sync.mutate()} disabled={sync.isPending}>
        {sync.isPending ? 'Sincronizando…' : '↻ Sincronizar MODO'}
      </button>
      <small className="hint">
        {sync.isError && 'Falló el sync (el sitio de MODO pudo haber cambiado). '}
        {sync.isSuccess &&
          `Listo: ${sync.data.cleared != null ? `${sync.data.cleared} borradas, ` : ''}${sync.data.imported} nuevas, ${sync.data.updated} actualizadas, ${sync.data.deactivated} dadas de baja. `}
        {modo?.lastRunAt && `Último sync: ${new Date(modo.lastRunAt).toLocaleString('es-AR')}`}
        {modo?.lastError && ` · último error: ${modo.lastError}`}
      </small>
    </div>
  );
}

export default function PromotionsPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'calendar' | 'when' | 'all'>('calendar');
  const [showForm, setShowForm] = useState(false);
  const [filterCategory, setFilterCategory] = useState<string | null>(null);
  const [filterEntity, setFilterEntity] = useState<string | null>(null);
  const [filterDiscountKind, setFilterDiscountKind] = useState<DiscountKind | null>(null);
  const [filterSource, setFilterSource] = useState<'all' | 'MANUAL' | 'SCRAPED'>('all');
  const [activeOnly, setActiveOnly] = useState(true);
  const [locationFilter, setLocationFilter] = useState<'household' | 'all'>('household');

  const { data: me } = useQuery({
    queryKey: ['me'],
    queryFn: () => api<{ household: { province: string | null } }>('/auth/me'),
  });

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

  return (
    <div className="page">
      <header className="page-header">
        <h1>Promociones</h1>
        <button className="icon-btn" onClick={() => setShowForm(!showForm)} aria-label="Agregar promo">
          {showForm ? '✕' : '＋'}
        </button>
      </header>

      <SyncModoButton />

      {showForm && entities && categories && (
        <PromoForm entities={entities} categories={categories} onDone={() => setShowForm(false)} />
      )}

      <div className="segmented">
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

      {tab === 'calendar' && <WeeklyCalendar />}

      {tab === 'when' && categories && <WhenToGo categories={categories} />}

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
          {visiblePromos?.map((p) => (
            <PromoCard key={p.id} promo={p} onDeactivate={p.active ? () => deactivate(p.id) : undefined} />
          ))}
        </>
      )}
    </div>
  );
}
