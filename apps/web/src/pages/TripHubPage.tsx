import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import ConfirmDialog from '../components/ConfirmDialog';
import TripExportBreakdown from '../components/TripExportBreakdown';
import NestedChecklist from '../components/NestedChecklist';
import { ResumenHoyItinerary, TripItinerarioTab } from '../components/TripItinerarioTab';
import TripSpendSummary from '../components/TripSpendSummary';
import { WeatherIcon } from '../components/WeatherIcon';
import { Button, Icon, IconButton, Chip, ListItem } from '../components/ui';
import { ApiError, api, fmtDate, fmtMoney } from '../lib/api';
import { useAuth } from '../lib/auth';
import type {
  TripExpense,
  TripExportPreview,
  TripForecast,
  TripHub,
  TripListItemRow,
  TripMember,
  TripMemberRole,
  TripPackingSuggestion,
} from '../lib/trip-types';
import type { SessionUser } from '../lib/types';
import {
  TRIP_CATEGORY_COLORS,
  TRIP_CATEGORY_ICONS,
  TRIP_CATEGORY_LABELS,
  TRIP_STATUS_LABEL,
  accommodationMapsHref,
  dateInputValue,
  formatStayMoment,
  formatTripExpensePayers,
  isHttpUrl,
  rankMergeTargets,
  timeInputValue,
  tripInviteUrl,
} from '../lib/trip-utils';
import {
  appendPackingChecklistItem,
  isLegacyPackingBoilerplate,
  isPackingListTitle,
  notesAreChecklist,
  PACKING_SECTION_LABELS,
  packingChecklistProgress,
  packingChecklistTitles,
  parsePackingChecklist,
  togglePackingChecklistLine,
  type PackingSection,
} from '../lib/packing-checklist';

type HubTab = 'resumen' | 'gastos' | 'listas' | 'alojamiento' | 'personas' | 'itinerario';

const TAB_IDS: HubTab[] = ['resumen', 'gastos', 'listas', 'alojamiento', 'personas', 'itinerario'];

function parseTab(value: string | null): HubTab {
  if (value && TAB_IDS.includes(value as HubTab)) return value as HubTab;
  return 'resumen';
}

export default function TripHubPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isGuestSession, applySession } = useAuth();
  const [tab, setTab] = useState<HubTab>(() => parseTab(searchParams.get('tab')));
  const [settleOpen, setSettleOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportSuccess, setExportSuccess] = useState<TripExportPreview | null>(null);
  const [copied, setCopied] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

  useEffect(() => {
    setTab(parseTab(searchParams.get('tab')));
  }, [searchParams]);

  const changeTab = (next: HubTab) => {
    setTab(next);
    if (next === 'resumen') {
      setSearchParams({}, { replace: true });
    } else {
      setSearchParams({ tab: next }, { replace: true });
    }
  };

  const { data: trip, isLoading, error } = useQuery({
    queryKey: ['trips', id],
    queryFn: () => api<TripHub>(`/trips/${id}`),
    enabled: Boolean(id),
  });

  const settleMutation = useMutation({
    mutationFn: () =>
      api(`/trips/${id}/settle`, { method: 'POST', body: JSON.stringify({ close: true }) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['trips', id] });
      void queryClient.invalidateQueries({ queryKey: ['trips'] });
      setSettleOpen(false);
    },
  });

  const exportPreview = useQuery({
    queryKey: ['trips', id, 'export-preview'],
    queryFn: () => api<TripExportPreview>(`/trips/${id}/export/preview`),
    enabled: Boolean(id) && exportOpen && !isGuestSession,
  });

  const exportMutation = useMutation({
    mutationFn: () =>
      api<{
        batchId: string;
        purchaseIds: string[];
        netShare: number;
        categoryMix: TripExportPreview['categoryMix'];
      }>(`/trips/${id}/export`, { method: 'POST', body: '{}' }),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ['trips', id] });
      void queryClient.invalidateQueries({ queryKey: ['expenses'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      setExportSuccess({
        eligible: false,
        alreadyExported: true,
        tripId: id!,
        householdId: '',
        netShare: data.netShare,
        categoryMix: data.categoryMix,
      });
    },
  });

  if (isLoading) {
    return (
      <div className="page">
        <p className="hint">Cargando viaje…</p>
      </div>
    );
  }

  if (error || !trip) {
    return (
      <div className="page">
        <p className="error">No se pudo cargar el viaje</p>
        {!isGuestSession && <Link to="/viajes">← Volver a Viajes</Link>}
      </div>
    );
  }

  const closed = trip.status === 'CLOSED';
  const canEditDetails = trip.isOrganizer && !closed;
  const inviteLink = trip.shareSlug
    ? tripInviteUrl(trip.shareSlug)
    : trip.inviteCode
      ? tripInviteUrl(trip.inviteCode)
      : null;
  const guest = isGuestSession || trip.isGuestSession;

  const copyInvite = async () => {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  const headerMeta = (
    <>
      <h1 style={{ margin: 0 }}>{trip.name}</h1>
      <p className="hint" style={{ margin: 0 }}>
        {trip.destination ? `${trip.destination} · ` : ''}
        {TRIP_STATUS_LABEL[trip.status]}
      </p>
    </>
  );

  return (
    <div className="page">
      <header className="page-header">
        {!guest ? (
          <IconButton icon="arrow_back" label="Volver" to="/viajes" />
        ) : (
          <span />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          {canEditDetails ? (
            <button
              type="button"
              className="trip-header-details-btn"
              onClick={() => setDetailsOpen(true)}
              aria-label="Editar datos del viaje"
            >
              {headerMeta}
            </button>
          ) : (
            headerMeta
          )}
        </div>
        <span />
      </header>

      {canEditDetails && (
        <TripDetailsDialog trip={trip} open={detailsOpen} onClose={() => setDetailsOpen(false)} />
      )}

      {guest && (
        <div className="card" style={{ marginBottom: 12 }}>
          <p style={{ marginTop: 0 }}>
            Estás en el viaje sin cuenta. Guardá tu acceso para entrar desde otro dispositivo.
          </p>
          {!linkOpen ? (
            <Button type="button" variant="filled" size="sm" onClick={() => setLinkOpen(true)}>
              Guardá tu acceso
            </Button>
          ) : (
            <LinkAccountForm
              tripId={trip.id}
              defaultName={trip.myMember.displayName}
              onSuccess={(token, sessionUser) => {
                applySession(token, sessionUser);
                setLinkOpen(false);
                void queryClient.invalidateQueries({ queryKey: ['trips', id] });
              }}
              onCancel={() => setLinkOpen(false)}
            />
          )}
        </div>
      )}

      {tab === 'resumen' && (
        <ResumenTab
          trip={trip}
          closed={closed}
          onSettle={() => setSettleOpen(true)}
          onExport={
            guest
              ? undefined
              : () => {
                  exportMutation.reset();
                  setExportSuccess(null);
                  setExportOpen(true);
                }
          }
          onOpenAlojamiento={() => changeTab('alojamiento')}
          onOpenItinerario={() => changeTab('itinerario')}
        />
      )}
      {tab === 'gastos' && (
        <GastosTab tripId={trip.id} closed={closed} onAdd={() => navigate(`/viajes/${trip.id}/gastos/nuevo`)} />
      )}
      {tab === 'listas' && <ListasTab trip={trip} closed={closed} />}
      {tab === 'itinerario' && (
        <TripItinerarioTab
          trip={trip}
          closed={closed}
          onOpenAlojamiento={() => changeTab('alojamiento')}
        />
      )}
      {tab === 'alojamiento' && (
        <>
          <button type="button" className="btn-link" onClick={() => changeTab('resumen')}>
            ← Resumen
          </button>
          <AlojamientoTab trip={trip} closed={closed} />
        </>
      )}
      {tab === 'personas' && (
        <PersonasTab
          trip={trip}
          inviteLink={inviteLink}
          copied={copied}
          onCopy={copyInvite}
        />
      )}

      <ConfirmDialog
        open={settleOpen}
        title="Liquidar viaje"
        variant="primary"
        confirmLabel="Liquidar y cerrar"
        loadingLabel="Liquidando…"
        loading={settleMutation.isPending}
        message={
          trip.balance.transfers.length === 0 ? (
            <p>Están a mano. ¿Cerrar el viaje?</p>
          ) : (
            <ul className="settle-confirm-list">
              {trip.balance.transfers.map((t) => (
                <li key={`${t.fromUnitId}-${t.toUnitId}`}>
                  <strong>{t.fromName}</strong> le paga a <strong>{t.toName}</strong>:{' '}
                  {fmtMoney(t.amount)}
                </li>
              ))}
            </ul>
          )
        }
        onConfirm={() => settleMutation.mutate()}
        onCancel={() => setSettleOpen(false)}
      />

      {!guest && (
        <ConfirmDialog
          open={exportOpen}
          title={exportSuccess ? 'Pasado a Biko' : 'Pasar a Biko'}
          variant="primary"
          confirmLabel={exportSuccess ? 'Listo' : 'Pasar a Biko'}
          singleAction={Boolean(exportSuccess)}
          loadingLabel="Exportando…"
          loading={exportMutation.isPending}
          message={
            exportSuccess ? (
              <TripExportBreakdown
                netShare={exportSuccess.netShare}
                categoryMix={exportSuccess.categoryMix}
                mode="success"
              />
            ) : exportPreview.isLoading ? (
              <p>Calculando…</p>
            ) : exportPreview.data && !exportPreview.data.eligible ? (
              <p>{exportPreview.data.reason ?? 'No disponible'}</p>
            ) : (
              <div>
                <TripExportBreakdown
                  netShare={exportPreview.data?.netShare ?? 0}
                  categoryMix={exportPreview.data?.categoryMix ?? []}
                  mode="preview"
                />
                {exportMutation.isError && (
                  <p className="error">
                    {exportMutation.error instanceof Error
                      ? exportMutation.error.message
                      : 'No se pudo pasar el viaje a Biko'}
                  </p>
                )}
              </div>
            )
          }
          onConfirm={() => {
            if (exportSuccess) {
              setExportOpen(false);
              setExportSuccess(null);
              return;
            }
            if (exportPreview.data?.eligible) exportMutation.mutate();
            else setExportOpen(false);
          }}
          onCancel={() => {
            setExportOpen(false);
            setExportSuccess(null);
          }}
        />
      )}
    </div>
  );
}

function LinkAccountForm({
  tripId,
  defaultName,
  onSuccess,
  onCancel,
}: {
  tripId: string;
  defaultName: string;
  onSuccess: (token: string, user: SessionUser) => void;
  onCancel: () => void;
}) {
  const [mode, setMode] = useState<'register' | 'login'>('register');
  const [name, setName] = useState(defaultName);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      api<{ token: string; user: SessionUser }>(`/trips/${tripId}/link-account`, {
        method: 'POST',
        body: JSON.stringify({
          mode,
          email: email.trim(),
          password,
          name: mode === 'register' ? name.trim() : undefined,
        }),
      }),
    onSuccess: (res) => onSuccess(res.token, { ...res.user, isGuestSession: false }),
    onError: (err) => setError(err instanceof Error ? err.message : 'No se pudo guardar'),
  });

  return (
    <form
      className="promo-form"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        mutation.mutate();
      }}
    >
      <div className="row-between" style={{ gap: 8, marginBottom: 8 }}>
        <Button
          type="button"
          size="sm"
          variant={mode === 'register' ? 'filled' : 'outlined'}
          onClick={() => setMode('register')}
        >
          Crear acceso
        </Button>
        <Button
          type="button"
          size="sm"
          variant={mode === 'login' ? 'filled' : 'outlined'}
          onClick={() => setMode('login')}
        >
          Ya tengo cuenta
        </Button>
      </div>
      {mode === 'register' && (
        <label>
          Nombre
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
      )}
      <label>
        Email
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
        />
      </label>
      <label>
        Contraseña
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
          autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
        />
      </label>
      {error && <p className="error">{error}</p>}
      <div className="row-between" style={{ gap: 8 }}>
        <Button type="button" variant="text" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" variant="filled" disabled={mutation.isPending}>
          {mutation.isPending ? 'Guardando…' : 'Guardar'}
        </Button>
      </div>
    </form>
  );
}

function useTripForecast(trip: TripHub) {
  const canFetch = Boolean(trip.destination?.trim() && trip.startDate && trip.endDate);
  return useQuery({
    queryKey: ['trips', trip.id, 'forecast'],
    queryFn: () => api<TripForecast>(`/trips/${trip.id}/forecast`),
    enabled: canFetch,
    staleTime: 30 * 60 * 1000,
    retry: false,
  });
}

function forecastErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'No se pudo cargar el pronóstico';
}

function weekdayShort(isoDate: string): string {
  const m = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const d = m
    ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12)
    : new Date(isoDate);
  return d.toLocaleDateString('es-AR', { weekday: 'short' }).replace(/\.$/, '');
}

function TripForecastCard({ trip }: { trip: TripHub }) {
  const canFetch = Boolean(trip.destination?.trim() && trip.startDate && trip.endDate);
  const forecastQuery = useTripForecast(trip);

  if (!canFetch) {
    return (
      <section className="card">
        <h2 style={{ margin: 0 }}>Clima</h2>
        <p className="hint" style={{ margin: '8px 0 0' }}>
          Falta destino o fechas para ver el pronóstico
        </p>
      </section>
    );
  }

  if (forecastQuery.isLoading) {
    return (
      <section className="card">
        <h2 style={{ margin: 0 }}>Clima</h2>
        <p className="hint" style={{ margin: '8px 0 0' }}>
          Buscando pronóstico…
        </p>
      </section>
    );
  }

  if (forecastQuery.isError || !forecastQuery.data) {
    return (
      <section className="card">
        <h2 style={{ margin: 0 }}>Clima</h2>
        <p className="hint" style={{ margin: '8px 0 0' }}>
          {forecastErrorMessage(forecastQuery.error) || 'No hay pronóstico disponible aún'}
        </p>
      </section>
    );
  }

  const forecast = forecastQuery.data;
  const place = [forecast.location.name, forecast.location.country].filter(Boolean).join(', ');
  const summaryCode =
    forecast.daily.find((d) => d.weatherCode != null)?.weatherCode ??
    forecast.daily[0]?.weatherCode ??
    0;

  return (
    <section className="card trip-forecast-card">
      <div className="row-between" style={{ alignItems: 'flex-start', gap: 12 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', minWidth: 0 }}>
          <WeatherIcon code={summaryCode} size={48} title={forecast.summary.label} />
          <div style={{ minWidth: 0 }}>
            <h2 style={{ margin: 0 }}>Clima</h2>
            <p className="hint" style={{ margin: '2px 0 0' }}>
              {place}
            </p>
          </div>
        </div>
        <p className="trip-forecast-summary-temps">
          {Math.round(forecast.summary.tMax)}°{' '}
          <span className="hint">{Math.round(forecast.summary.tMin)}°</span>
        </p>
      </div>
      <p style={{ margin: '8px 0 0' }}>
        {forecast.summary.label}
        {forecast.summary.rainyDays > 0
          ? ` · ${forecast.summary.rainyDays} día${forecast.summary.rainyDays === 1 ? '' : 's'} con lluvia`
          : ''}
      </p>
      {forecast.range.truncated && (
        <p className="hint" style={{ margin: '4px 0 0' }}>
          Pronóstico parcial (hasta 16 días desde hoy)
        </p>
      )}
      <div className="trip-forecast-strip" role="list">
        {forecast.daily.map((day) => (
          <div key={day.date} className="trip-forecast-day" role="listitem">
            <span className="trip-forecast-weekday">{weekdayShort(day.date)}</span>
            <WeatherIcon code={day.weatherCode} size={36} />
            <span className="trip-forecast-temps">
              {Math.round(day.tMax)}°{' '}
              <span className="hint">{Math.round(day.tMin)}°</span>
            </span>
            <span className="trip-forecast-precip">{Math.round(day.precipProb)}%</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function TripDetailsDialog({
  trip,
  open,
  onClose,
}: {
  trip: TripHub;
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(trip.name);
  const [destination, setDestination] = useState(trip.destination ?? '');
  const [startDate, setStartDate] = useState(dateInputValue(trip.startDate));
  const [endDate, setEndDate] = useState(dateInputValue(trip.endDate));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(trip.name);
    setDestination(trip.destination ?? '');
    setStartDate(dateInputValue(trip.startDate));
    setEndDate(dateInputValue(trip.endDate));
    setError(null);
  }, [open, trip.name, trip.destination, trip.startDate, trip.endDate]);

  const saveMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api(`/trips/${trip.id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['trips', trip.id] });
      void queryClient.invalidateQueries({ queryKey: ['trips'] });
      void queryClient.invalidateQueries({ queryKey: ['trips', trip.id, 'forecast'] });
      setError(null);
      onClose();
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'No se pudo guardar'),
  });

  const onSave = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const trimmed = name.trim();
    if (!trimmed) {
      setError('El nombre es obligatorio');
      return;
    }
    if (startDate && endDate && startDate > endDate) {
      setError('La fecha de fin debe ser posterior al inicio');
      return;
    }
    saveMutation.mutate({
      name: trimmed,
      destination: destination.trim() || null,
      startDate: startDate || null,
      endDate: endDate || null,
    });
  };

  if (!open) return null;

  return (
    <div className="md-dialog-overlay" role="presentation" onClick={onClose}>
      <div
        className="md-dialog trip-details-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="trip-details-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="trip-details-title">Datos del viaje</h2>
        <div className="md-dialog-body">
          <form className="promo-form" id="trip-details-form" onSubmit={onSave}>
            <label>
              Nombre
              <input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
            </label>
            <label>
              Destino
              <input
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                placeholder="Ciudad o lugar"
              />
            </label>
            <div className="form-row-2">
              <label>
                Desde
                <input
                  type="date"
                  value={startDate}
                  max={endDate || undefined}
                  onChange={(e) => {
                    const next = e.target.value;
                    setStartDate(next);
                    if (next && endDate && endDate < next) setEndDate(next);
                  }}
                />
              </label>
              <label>
                Hasta
                <input
                  type="date"
                  value={endDate}
                  min={startDate || undefined}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </label>
            </div>
            {error && <p className="error">{error}</p>}
          </form>
        </div>
        <div className="md-dialog-actions">
          <Button
            type="button"
            variant="text"
            onClick={onClose}
            disabled={saveMutation.isPending}
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            form="trip-details-form"
            variant="filled"
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending ? 'Guardando…' : 'Guardar'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function TripExportSummaryCard({ tripId }: { tripId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['trips', tripId, 'export-summary'],
    queryFn: () => api<TripExportPreview>(`/trips/${tripId}/export/preview`),
  });

  if (isLoading) {
    return (
      <section className="card trip-export-summary">
        <p className="hint">Cargando resumen en Biko…</p>
      </section>
    );
  }

  if (!data?.categoryMix.length) {
    return (
      <section className="card trip-export-summary">
        <h2 style={{ margin: 0 }}>En Biko</h2>
        <p className="hint" style={{ margin: '8px 0 0' }}>
          Ya pasado a Biko
        </p>
      </section>
    );
  }

  return (
    <section className="card trip-export-summary">
      <h2 style={{ margin: 0 }}>En Biko</h2>
      <TripExportBreakdown netShare={data.netShare} categoryMix={data.categoryMix} mode="summary" />
    </section>
  );
}

function ResumenTab({
  trip,
  closed,
  onSettle,
  onExport,
  onOpenAlojamiento,
  onOpenItinerario,
}: {
  trip: TripHub;
  closed: boolean;
  onSettle: () => void;
  onExport?: () => void;
  onOpenAlojamiento: () => void;
  onOpenItinerario: () => void;
}) {
  const acc = trip.accommodation;
  const checkInLabel = acc ? formatStayMoment(acc.checkIn, acc.checkInTime, fmtDate) : null;
  const checkOutLabel = acc ? formatStayMoment(acc.checkOut, acc.checkOutTime, fmtDate) : null;

  return (
    <>
      <section className="hero-card">
        <p className="hero-label">Total del viaje</p>
        <p className="hero-amount">{fmtMoney(trip.totalSpent)}</p>
        {(trip.startDate || trip.endDate) && (
          <p className="hero-meta">
            {trip.startDate ? fmtDate(trip.startDate) : '—'}
            {' → '}
            {trip.endDate ? fmtDate(trip.endDate) : '—'}
          </p>
        )}
      </section>

      <TripForecastCard trip={trip} />

      <ResumenHoyItinerary
        trip={trip}
        onOpenItinerario={onOpenItinerario}
        onOpenAlojamiento={onOpenAlojamiento}
      />

      <section
        className="card trip-accommodation-entry"
        role="button"
        tabIndex={0}
        onClick={onOpenAlojamiento}
        onKeyDown={(ev) => {
          if (ev.key === 'Enter' || ev.key === ' ') {
            ev.preventDefault();
            onOpenAlojamiento();
          }
        }}
      >
        <div className="row-between">
          <h2 style={{ margin: 0 }}>Alojamiento</h2>
          <span className="hint">{acc ? 'Ver' : closed ? '' : 'Agregar'}</span>
        </div>
        {acc ? (
          <>
            <p style={{ margin: '8px 0 0' }}>
              <strong>{acc.label || 'Alojamiento'}</strong>
            </p>
            {acc.address && !isHttpUrl(acc.address) && (
              <p className="hint" style={{ margin: '4px 0 0' }}>
                {acc.address}
              </p>
            )}
            {(checkInLabel || checkOutLabel) && (
              <p className="hint" style={{ margin: '4px 0 0' }}>
                {checkInLabel ? `Check-in ${checkInLabel}` : 'Check-in —'}
                {' · '}
                {checkOutLabel ? `Check-out ${checkOutLabel}` : 'Check-out —'}
              </p>
            )}
          </>
        ) : (
          <p className="hint" style={{ margin: '8px 0 0' }}>
            {closed ? 'Sin alojamiento cargado' : 'Tocá para cargar el lugar donde se quedan'}
          </p>
        )}
      </section>

      <TripSpendSummary trip={trip} />

      {!closed && (
        <button type="button" className="btn-primary" onClick={onSettle}>
          Liquidar viaje
        </button>
      )}

      {closed && (
        <p className="hint center">Viaje liquidado</p>
      )}

      {trip.canExport && onExport && (
        <button type="button" className="btn-secondary" onClick={onExport}>
          Pasar a Biko
        </button>
      )}

      {trip.alreadyExported && <TripExportSummaryCard tripId={trip.id} />}
    </>
  );
}

function GastosTab({
  tripId,
  closed,
  onAdd,
}: {
  tripId: string;
  closed: boolean;
  onAdd: () => void;
}) {
  const navigate = useNavigate();
  const { data: expenses, isLoading } = useQuery({
    queryKey: ['trips', tripId, 'expenses'],
    queryFn: () => api<TripExpense[]>(`/trips/${tripId}/expenses`),
  });

  return (
    <>
      {!closed && (
        <button type="button" className="btn-primary" onClick={onAdd}>
          + Agregar gasto
        </button>
      )}
      {isLoading && <p className="hint">Cargando…</p>}
      {!isLoading && (!expenses || expenses.length === 0) && (
        <p className="empty-state">Todavía no hay gastos</p>
      )}
      {expenses?.map((e) => (
        <div
          key={e.id}
          className="expense-row card expense-row-interactive"
          role="button"
          tabIndex={0}
          onClick={() => navigate(`/viajes/${tripId}/gastos/${e.id}`)}
          onKeyDown={(ev) => {
            if (ev.key === 'Enter' || ev.key === ' ') {
              ev.preventDefault();
              navigate(`/viajes/${tripId}/gastos/${e.id}`);
            }
          }}
        >
          <div
            className="expense-cat"
            style={{ background: TRIP_CATEGORY_COLORS[e.category] ?? '#ddd', color: '#fff' }}
          >
            <Icon name={TRIP_CATEGORY_ICONS[e.category] ?? 'payments'} size="sm" />
          </div>
          <div className="expense-main">
            <strong>{TRIP_CATEGORY_LABELS[e.category]}</strong>
            <small>
              {formatTripExpensePayers(e, fmtMoney)} · {fmtDate(e.date)}
            </small>
            {e.note && <small>{e.note}</small>}
          </div>
          <div className="expense-amounts">
            <span>{fmtMoney(e.amount)}</span>
          </div>
        </div>
      ))}
    </>
  );
}

function listItemTypeLabel(type: TripListItemRow['type']): string {
  if (type === 'PACK') return 'Llevar';
  if (type === 'BUY') return 'Comprar';
  return 'Hacer';
}

function listItemAssigneeLabel(item: TripListItemRow): string | null {
  if (item.assignToAll) return 'Todos';
  if (item.assignees.length === 0) return null;
  return item.assignees.map((m) => m.displayName).join(', ');
}

function isMyListItem(item: TripListItemRow, myMemberId: string): boolean {
  if (item.assignToAll) return true;
  return item.assignees.some((m) => m.id === myMemberId);
}

function PackingSuggestionsCard({
  suggestions,
  summaryLabel,
  applying,
  error,
  onAddAll,
  onAddOne,
}: {
  suggestions: TripPackingSuggestion[];
  summaryLabel: string | null;
  applying: boolean;
  error: string | null;
  onAddAll: () => void;
  onAddOne: (suggestion: TripPackingSuggestion) => void;
}) {
  const bySection = (Object.keys(PACKING_SECTION_LABELS) as PackingSection[])
    .map((section) => ({
      section,
      label: PACKING_SECTION_LABELS[section],
      items: suggestions.filter((s) => (s.section ?? 'viaje') === section),
    }))
    .filter((group) => group.items.length > 0);

  return (
    <section className="card">
      <div className="row-between" style={{ gap: 8, alignItems: 'flex-start' }}>
        <div>
          <h2 style={{ margin: 0 }}>Según el clima</h2>
          <p className="hint" style={{ margin: '4px 0 0' }}>
            {summaryLabel
              ? `${summaryLabel} · ${suggestions.length} pendientes para la lista`
              : `${suggestions.length} pendientes para armar la lista`}
          </p>
        </div>
        <button
          type="button"
          className="btn-secondary"
          disabled={applying}
          onClick={onAddAll}
        >
          {applying ? 'Agregando…' : 'Agregar todas'}
        </button>
      </div>
      {bySection.map((group) => (
        <div key={group.section} className="listas-packing-suggest-group">
          <p className="listas-packing-suggest-label">{group.label}</p>
          <div className="chip-row">
            {group.items.map((s) => (
              <Chip
                key={s.title}
                title={s.reason}
                disabled={applying}
                onClick={() => onAddOne(s)}
              >
                + {s.title}
              </Chip>
            ))}
          </div>
        </div>
      ))}
      {error && (
        <p className="error" style={{ marginTop: 8 }}>
          {error}
        </p>
      )}
    </section>
  );
}

function ListasTab({ trip, closed }: { trip: TripHub; closed: boolean }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [mineOnly, setMineOnly] = useState(false);

  const { data: items, isLoading } = useQuery({
    queryKey: ['trips', trip.id, 'list-items'],
    queryFn: () => api<TripListItemRow[]>(`/trips/${trip.id}/list-items`),
  });

  const forecastQuery = useTripForecast(trip);

  const pendingSuggestions = useMemo(() => {
    const suggestions = forecastQuery.data?.packingSuggestions ?? [];
    if (suggestions.length === 0) return [];
    const packingList = (items ?? []).find(
      (i) => i.type === 'PACK' && isPackingListTitle(i.title),
    );
    const inChecklist = new Set(
      packingChecklistTitles(packingList?.notes).map((t) => t.toLowerCase()),
    );
    // Legacy: individual PACK items created before the unified checklist.
    const asStandalone = new Set((items ?? []).map((i) => i.title.trim().toLowerCase()));
    return suggestions.filter((s) => {
      if (isLegacyPackingBoilerplate(s.title)) return false;
      const key = s.title.toLowerCase();
      return !inChecklist.has(key) && !asStandalone.has(key);
    });
  }, [forecastQuery.data, items]);

  const forecastSummaryLabel = useMemo(() => {
    const summary = forecastQuery.data?.summary;
    if (!summary) return null;
    const climate = summary.climateLabel?.trim();
    const parts = [
      climate ? `Pronóstico: ${climate}` : summary.label,
      `${Math.round(summary.tMin)}–${Math.round(summary.tMax)}°C`,
    ];
    if (summary.rainyDays > 0) {
      parts.push(
        summary.rainyDays === 1 ? '1 día con lluvia' : `${summary.rainyDays} días con lluvia`,
      );
    }
    return parts.join(' · ');
  }, [forecastQuery.data?.summary]);

  const filtered = useMemo(() => {
    const all = items ?? [];
    if (mineOnly) {
      return all.filter((i) => isMyListItem(i, trip.myMember.id));
    }
    return all;
  }, [items, mineOnly, trip.myMember.id]);

  const toggleMutation = useMutation({
    mutationFn: ({ itemId, status }: { itemId: string; status: 'PENDING' | 'DONE' }) =>
      api(`/trips/${trip.id}/list-items/${itemId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      }),
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({ queryKey: ['trips', trip.id, 'list-items'] });
      void queryClient.invalidateQueries({
        queryKey: ['trips', trip.id, 'list-items', vars.itemId, 'activities'],
      });
    },
  });

  const checklistToggleMutation = useMutation({
    mutationFn: ({
      itemId,
      notes: nextNotes,
      status,
    }: {
      itemId: string;
      notes: string;
      status?: 'PENDING' | 'DONE';
    }) =>
      api(`/trips/${trip.id}/list-items/${itemId}`, {
        method: 'PATCH',
        body: JSON.stringify({ notes: nextNotes, ...(status ? { status } : {}) }),
      }),
    onMutate: async ({ itemId, notes: nextNotes, status }) => {
      await queryClient.cancelQueries({ queryKey: ['trips', trip.id, 'list-items'] });
      const previous = queryClient.getQueryData<TripListItemRow[]>([
        'trips',
        trip.id,
        'list-items',
      ]);
      queryClient.setQueryData<TripListItemRow[]>(['trips', trip.id, 'list-items'], (old) =>
        (old ?? []).map((item) =>
          item.id === itemId
            ? { ...item, notes: nextNotes, status: status ?? item.status }
            : item,
        ),
      );
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(['trips', trip.id, 'list-items'], ctx.previous);
      }
    },
    onSettled: (_data, _err, vars) => {
      void queryClient.invalidateQueries({ queryKey: ['trips', trip.id, 'list-items'] });
      void queryClient.invalidateQueries({
        queryKey: ['trips', trip.id, 'list-items', vars.itemId, 'activities'],
      });
    },
  });

  const applyPackingMutation = useMutation({
    mutationFn: (itemsToAdd: Array<{ title: string; section: PackingSection }>) =>
      api<TripListItemRow[]>(`/trips/${trip.id}/packing-suggestions/apply`, {
        method: 'POST',
        body: JSON.stringify({ items: itemsToAdd }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['trips', trip.id, 'list-items'] });
      void queryClient.invalidateQueries({ queryKey: ['trips', trip.id, 'forecast'] });
    },
  });

  const emptyCopy = mineOnly ? 'No tenés tareas asignadas' : 'Todavía no hay ítems';
  const showPackingSuggestions = !closed && pendingSuggestions.length > 0;

  const toggleChecklistLine = (item: TripListItemRow, lineIndex: number) => {
    const nextNotes = togglePackingChecklistLine(item.notes, lineIndex);
    const progress = packingChecklistProgress(nextNotes);
    const status =
      progress.total > 0 && progress.done === progress.total
        ? ('DONE' as const)
        : progress.done < progress.total && item.status === 'DONE'
          ? ('PENDING' as const)
          : undefined;
    checklistToggleMutation.mutate({ itemId: item.id, notes: nextNotes, status });
  };

  const addChecklistItem = (item: TripListItemRow, title: string) => {
    const nextNotes = appendPackingChecklistItem(item.notes, title);
    if (nextNotes === (item.notes ?? '')) return;
    const progress = packingChecklistProgress(nextNotes);
    const status =
      item.status === 'DONE' && progress.done < progress.total
        ? ('PENDING' as const)
        : undefined;
    checklistToggleMutation.mutate({ itemId: item.id, notes: nextNotes, status });
  };

  return (
    <>
      <div className="listas-toolbar">
        <Chip selected={mineOnly} onClick={() => setMineOnly((v) => !v)}>
          Mis tareas
        </Chip>
        {!closed && (
          <button
            type="button"
            className="btn-primary"
            onClick={() => navigate(`/viajes/${trip.id}/listas/nuevo`)}
          >
            + Agregar
          </button>
        )}
      </div>

      {isLoading && <p className="hint">Cargando…</p>}
      {!isLoading && filtered.length === 0 && <p className="empty-state">{emptyCopy}</p>}

      {!isLoading && filtered.length > 0 && (
        <div className="card listas-list">
          {filtered.map((item) => {
            const typeLabel = listItemTypeLabel(item.type);
            const assigneeLabel = listItemAssigneeLabel(item);
            const metaParts = [typeLabel, assigneeLabel].filter(Boolean);
            const isPackingList = item.type === 'PACK' && isPackingListTitle(item.title);
            const hasNestedChecklist = Boolean(
              item.notes &&
                (notesAreChecklist(item.notes) ||
                  (isPackingList &&
                    parsePackingChecklist(item.notes).some((e) => e.kind === 'item'))),
            );
            const hasMultilineNotes = Boolean(
              !hasNestedChecklist && item.notes && item.notes.includes('\n'),
            );
            const detailPath = `/viajes/${trip.id}/listas/${item.id}`;

            const support = hasNestedChecklist ? (
              <NestedChecklist
                notes={item.notes!}
                metaLabel={metaParts.length > 0 ? metaParts.join(' · ') : null}
                closed={closed}
                busy={checklistToggleMutation.isPending}
                onToggleLine={(lineIndex) => toggleChecklistLine(item, lineIndex)}
                onAddItem={!closed ? (title) => addChecklistItem(item, title) : undefined}
              />
            ) : metaParts.length > 0 || item.notes ? (
              <>
                {metaParts.length > 0 && <span>{metaParts.join(' · ')}</span>}
                {item.notes ? (
                  <span className={hasMultilineNotes ? 'listas-item-notes' : undefined}>
                    {metaParts.length > 0 && !hasMultilineNotes
                      ? ` · ${item.notes}`
                      : item.notes}
                  </span>
                ) : null}
              </>
            ) : undefined;

            return (
              <ListItem
                key={item.id}
                className={[
                  item.status === 'DONE' ? 'listas-item-done' : '',
                  hasMultilineNotes || hasNestedChecklist ? 'listas-item-multiline' : '',
                  hasNestedChecklist ? 'listas-item-checklist' : '',
                ]
                  .filter(Boolean)
                  .join(' ') || undefined}
                leading={
                  hasNestedChecklist ? (
                    <span className="listas-checklist-leading" aria-hidden />
                  ) : (
                    <input
                      type="checkbox"
                      checked={item.status === 'DONE'}
                      disabled={closed}
                      aria-label={item.status === 'DONE' ? 'Marcar pendiente' : 'Marcar hecho'}
                      onChange={() =>
                        toggleMutation.mutate({
                          itemId: item.id,
                          status: item.status === 'DONE' ? 'PENDING' : 'DONE',
                        })
                      }
                    />
                  )
                }
                title={
                  <Link to={detailPath} className="listas-item-title-link">
                    {item.title}
                  </Link>
                }
                support={support}
              />
            );
          })}
        </div>
      )}

      {showPackingSuggestions && (
        <PackingSuggestionsCard
          suggestions={pendingSuggestions}
          summaryLabel={forecastSummaryLabel}
          applying={applyPackingMutation.isPending}
          error={
            applyPackingMutation.isError
              ? forecastErrorMessage(applyPackingMutation.error)
              : null
          }
          onAddAll={() =>
            applyPackingMutation.mutate(
              pendingSuggestions.map((s) => ({
                title: s.title,
                section: s.section ?? 'viaje',
              })),
            )
          }
          onAddOne={(s) =>
            applyPackingMutation.mutate([
              { title: s.title, section: s.section ?? 'viaje' },
            ])
          }
        />
      )}
    </>
  );
}

function AlojamientoTab({ trip, closed }: { trip: TripHub; closed: boolean }) {
  const queryClient = useQueryClient();
  const acc = trip.accommodation;
  const currency = (trip.baseCurrency === 'USD' ? 'USD' : 'ARS') as 'ARS' | 'USD';
  const [editing, setEditing] = useState(!acc);
  const [label, setLabel] = useState(acc?.label ?? '');
  const [address, setAddress] = useState(acc?.address ?? '');
  const [checkIn, setCheckIn] = useState(dateInputValue(acc?.checkIn));
  const [checkOut, setCheckOut] = useState(dateInputValue(acc?.checkOut));
  const [checkInTime, setCheckInTime] = useState(timeInputValue(acc?.checkInTime));
  const [checkOutTime, setCheckOutTime] = useState(timeInputValue(acc?.checkOutTime));
  const [amount, setAmount] = useState(acc?.amount != null ? String(acc.amount) : '');
  const [link, setLink] = useState(acc?.link ?? '');
  const [notes, setNotes] = useState(acc?.notes ?? '');
  const [error, setError] = useState<string | null>(null);

  const saveMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api(`/trips/${trip.id}/accommodation`, { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['trips', trip.id] });
      setEditing(false);
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Error al guardar'),
  });

  const onSave = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const amountTrim = amount.trim().replace(',', '.');
    let amountValue: number | null = null;
    if (amountTrim) {
      const n = Number(amountTrim);
      if (!Number.isFinite(n) || n < 0) {
        setError('Ingresá un costo válido');
        return;
      }
      amountValue = n;
    }
    if (checkIn && checkOut && checkOut < checkIn) {
      setError('El check-out debe ser posterior al check-in');
      return;
    }
    saveMutation.mutate({
      label: label.trim() || null,
      address: address.trim() || null,
      checkIn: checkIn || null,
      checkOut: checkOut || null,
      checkInTime: checkInTime || null,
      checkOutTime: checkOutTime || null,
      amount: amountValue,
      link: link.trim() || null,
      notes: notes.trim() || null,
    });
  };

  if (!editing && acc) {
    const checkInLabel = formatStayMoment(acc.checkIn, acc.checkInTime, fmtDate);
    const checkOutLabel = formatStayMoment(acc.checkOut, acc.checkOutTime, fmtDate);
    return (
      <section className="card trip-accommodation-card">
        <h2>{acc.label || 'Alojamiento'}</h2>
        {acc.address && (
          <p className="trip-accommodation-address">
            {isHttpUrl(acc.address) ? (
              <a href={accommodationMapsHref(acc.address)} target="_blank" rel="noreferrer">
                Ver en mapa
              </a>
            ) : (
              <a href={accommodationMapsHref(acc.address)} target="_blank" rel="noreferrer">
                {acc.address}
              </a>
            )}
          </p>
        )}
        {(checkInLabel || checkOutLabel) && (
          <p className="hint">
            {checkInLabel ? `Check-in ${checkInLabel}` : 'Check-in —'}
            {' · '}
            {checkOutLabel ? `Check-out ${checkOutLabel}` : 'Check-out —'}
          </p>
        )}
        {acc.amount != null && (
          <p className="trip-accommodation-cost">
            Costo {fmtMoney(acc.amount, currency)}
            <span className="hint"> · cuenta en Gastos y balances</span>
          </p>
        )}
        {acc.expenseId && !closed && (
          <p className="hint">
            Para cambiar quién pagó o el reparto, editá el gasto de Alojamiento en Gastos.
          </p>
        )}
        {acc.link && (
          <p>
            <a href={acc.link} target="_blank" rel="noreferrer">
              Ver reserva
            </a>
          </p>
        )}
        {acc.notes && <p className="hint trip-accommodation-notes">{acc.notes}</p>}
        {!closed && (
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setLabel(acc.label ?? '');
              setAddress(acc.address ?? '');
              setCheckIn(dateInputValue(acc.checkIn));
              setCheckOut(dateInputValue(acc.checkOut));
              setCheckInTime(timeInputValue(acc.checkInTime));
              setCheckOutTime(timeInputValue(acc.checkOutTime));
              setAmount(acc.amount != null ? String(acc.amount) : '');
              setLink(acc.link ?? '');
              setNotes(acc.notes ?? '');
              setError(null);
              setEditing(true);
            }}
          >
            Editar
          </button>
        )}
      </section>
    );
  }

  if (closed && !acc) {
    return <p className="empty-state">Sin alojamiento cargado</p>;
  }

  return (
    <form className="card promo-form" onSubmit={onSave}>
      <h2>Alojamiento</h2>
      <label>
        Nombre
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Airbnb Centro" />
      </label>
      <label>
        Dirección o link de mapa
        <input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="Calle 123 o link de Google Maps"
        />
      </label>
      <div className="form-row-2">
        <label>
          Check-in
          <input
            type="date"
            value={checkIn}
            max={checkOut || undefined}
            onChange={(e) => {
              const next = e.target.value;
              setCheckIn(next);
              if (next && checkOut && checkOut < next) setCheckOut(next);
            }}
          />
        </label>
        <label>
          Hora check-in
          <input type="time" value={checkInTime} onChange={(e) => setCheckInTime(e.target.value)} />
        </label>
      </div>
      <div className="form-row-2">
        <label>
          Check-out
          <input
            type="date"
            value={checkOut}
            min={checkIn || undefined}
            onChange={(e) => setCheckOut(e.target.value)}
          />
        </label>
        <label>
          Hora check-out
          <input type="time" value={checkOutTime} onChange={(e) => setCheckOutTime(e.target.value)} />
        </label>
      </div>
      <label>
        Costo ({currency})
        <input
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="Opcional"
        />
      </label>
      <p className="hint">
        El costo se registra como gasto de Alojamiento (reparto igual entre viajeros) y suma a
        balances. Quién pagó se puede ajustar desde Gastos.
      </p>
      <label>
        Link de reserva
        <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…" />
      </label>
      <label>
        Notas
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Código de puerta…" />
      </label>
      {error && <p className="error">{error}</p>}
      <button type="submit" className="btn-primary" disabled={saveMutation.isPending}>
        {saveMutation.isPending ? 'Guardando…' : 'Guardar'}
      </button>
    </form>
  );
}

function memberStatusLabel(m: TripMember): string {
  if (m.inviteStatus === 'PENDING' && !m.userId) return 'Sin reclamar';
  if (m.inviteStatus === 'JOINED') return 'Unido';
  return 'Pendiente';
}

function canDeleteMember(trip: TripHub, m: TripMember): boolean {
  if (m.id === trip.myMember.id) return false;
  if (m.role === 'ORGANIZER') return false;
  return true;
}

function isPendingSlot(m: TripMember): boolean {
  return m.inviteStatus === 'PENDING' && !m.userId;
}

function PersonasTab({
  trip,
  inviteLink,
  copied,
  onCopy,
}: {
  trip: TripHub;
  inviteLink: string | null;
  copied: boolean;
  onCopy: () => void;
}) {
  const queryClient = useQueryClient();
  const closed = trip.status === 'CLOSED';
  const canEdit = trip.isOrganizer && !closed;
  const [newName, setNewName] = useState('');
  const [newGroupName, setNewGroupName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editHouseholdId, setEditHouseholdId] = useState('');
  const [editRole, setEditRole] = useState<TripMemberRole>('MEMBER');
  const [memberError, setMemberError] = useState<string | null>(null);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editingGroupName, setEditingGroupName] = useState('');
  const [mergeIntoId, setMergeIntoId] = useState('');

  const members = [...trip.members].sort((a, b) =>
    a.displayName.localeCompare(b.displayName, 'es', { sensitivity: 'base' }),
  );
  const households = [...(trip.households ?? [])].sort((a, b) =>
    a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }),
  );
  const householdName = (id: string | null) =>
    id ? households.find((h) => h.id === id)?.name ?? null : null;

  const selected = selectedId ? members.find((m) => m.id === selectedId) ?? null : null;
  const mergeTargets = selected
    ? rankMergeTargets(
        selected.displayName,
        members.filter((m) => m.id !== selected.id),
      )
    : [];

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['trips', trip.id] });
    void queryClient.invalidateQueries({ queryKey: ['trips', trip.id, 'expenses'] });
  };

  const openMember = (m: TripMember) => {
    setSelectedId(m.id);
    setEditName(m.displayName);
    setEditHouseholdId(m.tripHouseholdId ?? '');
    setEditRole(m.role);
    setMemberError(null);
    const ranked = rankMergeTargets(
      m.displayName,
      members.filter((x) => x.id !== m.id),
    );
    setMergeIntoId(ranked[0]?.id ?? '');
  };

  const closeMember = () => {
    setSelectedId(null);
    setMemberError(null);
    setMergeIntoId('');
  };

  const addMember = useMutation({
    mutationFn: (displayName: string) =>
      api(`/trips/${trip.id}/members`, {
        method: 'POST',
        body: JSON.stringify({ displayName }),
      }),
    onSuccess: () => {
      setNewName('');
      setError(null);
      invalidate();
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'No se pudo agregar'),
  });

  const deleteMember = useMutation({
    mutationFn: (memberId: string) =>
      api(`/trips/${trip.id}/members/${memberId}`, { method: 'DELETE' }),
    onSuccess: () => {
      closeMember();
      invalidate();
    },
    onError: (err) =>
      setMemberError(err instanceof Error ? err.message : 'No se pudo eliminar'),
  });

  const mergeMember = useMutation({
    mutationFn: ({ memberId, intoMemberId }: { memberId: string; intoMemberId: string }) =>
      api(`/trips/${trip.id}/members/${memberId}/merge`, {
        method: 'POST',
        body: JSON.stringify({ intoMemberId }),
      }),
    onSuccess: () => {
      closeMember();
      invalidate();
    },
    onError: (err) =>
      setMemberError(err instanceof Error ? err.message : 'No se pudo fusionar'),
  });

  const patchMember = useMutation({
    mutationFn: ({
      memberId,
      displayName,
      tripHouseholdId,
      role,
    }: {
      memberId: string;
      displayName?: string;
      tripHouseholdId?: string | null;
      role?: TripMemberRole;
    }) =>
      api(`/trips/${trip.id}/members/${memberId}`, {
        method: 'PATCH',
        body: JSON.stringify({ displayName, tripHouseholdId, role }),
      }),
    onSuccess: () => {
      closeMember();
      invalidate();
    },
    onError: (err) =>
      setMemberError(err instanceof Error ? err.message : 'No se pudo guardar'),
  });

  const addGroup = useMutation({
    mutationFn: (name: string) =>
      api(`/trips/${trip.id}/households`, {
        method: 'POST',
        body: JSON.stringify({ name }),
      }),
    onSuccess: () => {
      setNewGroupName('');
      setError(null);
      invalidate();
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'No se pudo crear el grupo'),
  });

  const deleteGroup = useMutation({
    mutationFn: (householdId: string) =>
      api(`/trips/${trip.id}/households/${householdId}`, { method: 'DELETE' }),
    onSuccess: invalidate,
    onError: (err) => setError(err instanceof Error ? err.message : 'No se pudo eliminar'),
  });

  const renameGroup = useMutation({
    mutationFn: ({ householdId, name }: { householdId: string; name: string }) =>
      api(`/trips/${trip.id}/households/${householdId}`, {
        method: 'PATCH',
        body: JSON.stringify({ name }),
      }),
    onSuccess: () => {
      setEditingGroupId(null);
      setEditingGroupName('');
      setError(null);
      invalidate();
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'No se pudo renombrar'),
  });

  const startEditGroup = (h: { id: string; name: string }) => {
    setEditingGroupId(h.id);
    setEditingGroupName(h.name);
    setError(null);
  };

  const saveEditGroup = () => {
    if (!editingGroupId) return;
    const name = editingGroupName.trim();
    if (!name) {
      setError('El nombre del grupo es obligatorio');
      return;
    }
    const current = households.find((h) => h.id === editingGroupId);
    if (current && name === current.name) {
      setEditingGroupId(null);
      setEditingGroupName('');
      return;
    }
    renameGroup.mutate({ householdId: editingGroupId, name });
  };

  const saveMember = () => {
    if (!selected) return;
    const name = editName.trim();
    if (!name) {
      setMemberError('El nombre es obligatorio');
      return;
    }
    const nextHousehold = editHouseholdId || null;
    const nameChanged = name !== selected.displayName;
    const householdChanged = nextHousehold !== (selected.tripHouseholdId ?? null);
    const roleChanged = !isPendingSlot(selected) && editRole !== selected.role;
    if (!nameChanged && !householdChanged && !roleChanged) {
      closeMember();
      return;
    }
    patchMember.mutate({
      memberId: selected.id,
      ...(nameChanged ? { displayName: name } : {}),
      ...(householdChanged ? { tripHouseholdId: nextHousehold } : {}),
      ...(roleChanged ? { role: editRole } : {}),
    });
  };

  return (
    <>
      <section className="card personas-list">
        <h2>Personas</h2>
        {members.map((m) => {
          const group = householdName(m.tripHouseholdId);
          return (
            <ListItem
              key={m.id}
              title={m.displayName}
              support={group ?? undefined}
              trailing={<span className="personas-status">{memberStatusLabel(m)}</span>}
              onClick={() => openMember(m)}
            />
          );
        })}
      </section>

      {trip.isOrganizer && !closed && (
        <section className="card">
          <h2>Agregar viajero</h2>
          <p className="hint">Creá un lugar con nombre. Pueden reclamarlo con el link de invitación.</p>
          <form
            className="promo-form"
            onSubmit={(e) => {
              e.preventDefault();
              const name = newName.trim();
              if (!name) return;
              addMember.mutate(name);
            }}
          >
            <label>
              Nombre
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Ej. Ana"
                required
              />
            </label>
            <button type="submit" className="btn-secondary" disabled={addMember.isPending}>
              {addMember.isPending ? 'Agregando…' : 'Agregar'}
            </button>
          </form>
        </section>
      )}

      {trip.isOrganizer && !closed && (
        <section className="card">
          <h2>Grupos del viaje</h2>
          <p className="hint">
            Agrupá viajeros para liquidar por grupo (no es el hogar de Biko).
          </p>
          {households.length > 0 && (
            <ul className="list-plain" style={{ marginBottom: 12 }}>
              {households.map((h) => {
                const count = members.filter((m) => m.tripHouseholdId === h.id).length;
                const isEditing = editingGroupId === h.id;
                return (
                  <li key={h.id} className="row-between list-row">
                    {isEditing ? (
                      <form
                        className="row-between"
                        style={{ flex: 1, gap: 8, alignItems: 'center' }}
                        onSubmit={(e) => {
                          e.preventDefault();
                          saveEditGroup();
                        }}
                      >
                        <input
                          value={editingGroupName}
                          onChange={(e) => setEditingGroupName(e.target.value)}
                          autoFocus
                          required
                          aria-label="Nombre del grupo"
                          style={{ flex: 1 }}
                        />
                        <span className="list-row-actions">
                          <button
                            type="submit"
                            className="btn-link"
                            disabled={renameGroup.isPending}
                          >
                            {renameGroup.isPending ? 'Guardando…' : 'Guardar'}
                          </button>
                          <button
                            type="button"
                            className="btn-link"
                            onClick={() => {
                              setEditingGroupId(null);
                              setEditingGroupName('');
                            }}
                            disabled={renameGroup.isPending}
                          >
                            Cancelar
                          </button>
                        </span>
                      </form>
                    ) : (
                      <>
                        <span>
                          {h.name}
                          <span className="hint"> · {count} persona{count === 1 ? '' : 's'}</span>
                        </span>
                        <span className="list-row-actions">
                          <button
                            type="button"
                            className="btn-link"
                            onClick={() => startEditGroup(h)}
                            disabled={deleteGroup.isPending || renameGroup.isPending}
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            className="btn-link"
                            onClick={() => deleteGroup.mutate(h.id)}
                            disabled={deleteGroup.isPending || renameGroup.isPending}
                          >
                            Eliminar
                          </button>
                        </span>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <form
            className="promo-form"
            onSubmit={(e) => {
              e.preventDefault();
              const name = newGroupName.trim();
              if (!name) return;
              addGroup.mutate(name);
            }}
          >
            <label>
              Nombre del grupo
              <input
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                placeholder='Ej. "Los García"'
                required
              />
            </label>
            <button type="submit" className="btn-secondary" disabled={addGroup.isPending}>
              {addGroup.isPending ? 'Creando…' : 'Crear grupo'}
            </button>
          </form>
        </section>
      )}

      {inviteLink && trip.isOrganizer && !closed && (
        <section className="card">
          <h2>Invitar</h2>
          <p className="hint">
            Compartí el link. Quien entre puede elegir su nombre de la lista o sumarse como otro.
          </p>
          <code className="trip-invite-code">{inviteLink}</code>
          <button type="button" className="btn-secondary" onClick={onCopy}>
            {copied ? '¡Copiado!' : 'Copiar link'}
          </button>
        </section>
      )}

      {!inviteLink && trip.members.length < 2 && (
        <p className="empty-state">Invitá al grupo con el link</p>
      )}

      {error && <p className="error">{error}</p>}

      {selected && (
        <div className="md-dialog-overlay" role="presentation" onClick={closeMember}>
          <div
            className="md-dialog personas-member-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="personas-member-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="personas-member-title">{canEdit ? 'Editar persona' : selected.displayName}</h2>
            <div className="md-dialog-body">
              {canEdit ? (
                <form
                  className="promo-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    saveMember();
                  }}
                >
                  <label>
                    Nombre
                    <input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      required
                      autoFocus
                    />
                  </label>
                  <label>
                    Grupo
                    <select
                      value={editHouseholdId}
                      onChange={(e) => setEditHouseholdId(e.target.value)}
                    >
                      <option value="">Sin grupo</option>
                      {households.map((h) => (
                        <option key={h.id} value={h.id}>
                          {h.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  {!isPendingSlot(selected) && (
                    <label>
                      Rol
                      <select
                        value={editRole}
                        onChange={(e) => setEditRole(e.target.value as TripMemberRole)}
                      >
                        <option value="MEMBER">Miembro</option>
                        <option value="ORGANIZER">Organizador</option>
                      </select>
                    </label>
                  )}
                  {isPendingSlot(selected) && (
                    <p className="hint" style={{ margin: 0 }}>
                      Lugar sin reclamar. Pueden tomarlo con el link de invitación.
                    </p>
                  )}
                </form>
              ) : (
                <div className="personas-member-readonly">
                  <p>
                    <strong>{selected.displayName}</strong>
                  </p>
                  <p className="hint" style={{ margin: 0 }}>
                    {memberStatusLabel(selected)}
                    {householdName(selected.tripHouseholdId)
                      ? ` · ${householdName(selected.tripHouseholdId)}`
                      : ''}
                  </p>
                </div>
              )}
              {memberError && <p className="error">{memberError}</p>}
              {canEdit && canDeleteMember(trip, selected) && mergeTargets.length > 0 && (
                <div className="personas-merge" style={{ marginTop: 12 }}>
                  <p className="hint" style={{ margin: '0 0 8px' }}>
                    Fusionar elimina a <strong>{selected.displayName}</strong> del viaje y pasa
                    sus gastos y partes a la persona elegida.
                  </p>
                  <label>
                    Fusionar con
                    <select
                      value={mergeIntoId}
                      onChange={(e) => setMergeIntoId(e.target.value)}
                      disabled={mergeMember.isPending || deleteMember.isPending}
                    >
                      {mergeTargets.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.displayName}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              )}
            </div>
            <div className="md-dialog-actions personas-member-actions">
              {canEdit && canDeleteMember(trip, selected) && (
                <Button
                  type="button"
                  variant="danger-text"
                  disabled={
                    deleteMember.isPending || patchMember.isPending || mergeMember.isPending
                  }
                  onClick={() => deleteMember.mutate(selected.id)}
                >
                  {deleteMember.isPending ? 'Quitando…' : 'Quitar'}
                </Button>
              )}
              {canEdit && canDeleteMember(trip, selected) && mergeTargets.length > 0 && (
                <Button
                  type="button"
                  variant="text"
                  disabled={
                    !mergeIntoId ||
                    mergeMember.isPending ||
                    deleteMember.isPending ||
                    patchMember.isPending
                  }
                  onClick={() =>
                    mergeMember.mutate({ memberId: selected.id, intoMemberId: mergeIntoId })
                  }
                >
                  {mergeMember.isPending ? 'Fusionando…' : 'Fusionar y quitar'}
                </Button>
              )}
              <span className="personas-member-actions-spacer" />
              <Button
                type="button"
                variant="text"
                disabled={patchMember.isPending || mergeMember.isPending}
                onClick={closeMember}
              >
                {canEdit ? 'Cancelar' : 'Cerrar'}
              </Button>
              {canEdit && (
                <Button
                  type="button"
                  variant="tonal"
                  disabled={
                    patchMember.isPending || deleteMember.isPending || mergeMember.isPending
                  }
                  onClick={saveMember}
                >
                  {patchMember.isPending ? 'Guardando…' : 'Guardar'}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
