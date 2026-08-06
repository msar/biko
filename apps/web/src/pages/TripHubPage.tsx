import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import ConfirmDialog from '../components/ConfirmDialog';
import PieChart from '../components/charts/PieChart';
import { Button, IconButton, Chip, ListItem } from '../components/ui';
import { api, fmtDate, fmtMoney } from '../lib/api';
import { useAuth } from '../lib/auth';
import type {
  TripExpense,
  TripExportPreview,
  TripHub,
  TripListItemRow,
  TripMember,
  TripMemberRole,
} from '../lib/trip-types';
import type { SessionUser } from '../lib/types';
import {
  TRIP_CATEGORY_COLORS,
  TRIP_CATEGORY_LABELS,
  TRIP_STATUS_LABEL,
  accommodationMapsHref,
  dateInputValue,
  formatStayMoment,
  formatTripExpensePayers,
  isHttpUrl,
  timeInputValue,
  tripInviteUrl,
} from '../lib/trip-utils';

type HubTab = 'resumen' | 'gastos' | 'listas' | 'alojamiento' | 'personas';

const TAB_IDS: HubTab[] = ['resumen', 'gastos', 'listas', 'alojamiento', 'personas'];

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
  const [copied, setCopied] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);

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
    mutationFn: () => api(`/trips/${id}/export`, { method: 'POST', body: '{}' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['trips', id] });
      void queryClient.invalidateQueries({ queryKey: ['expenses'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      setExportOpen(false);
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

  return (
    <div className="page">
      <header className="page-header">
        {!guest ? (
          <IconButton icon="arrow_back" label="Volver" to="/viajes" />
        ) : (
          <span />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ margin: 0 }}>{trip.name}</h1>
          <p className="hint" style={{ margin: 0 }}>
            {trip.destination ? `${trip.destination} · ` : ''}
            {TRIP_STATUS_LABEL[trip.status]}
          </p>
        </div>
        <span />
      </header>

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
          onExport={guest ? undefined : () => setExportOpen(true)}
          onOpenAlojamiento={() => changeTab('alojamiento')}
        />
      )}
      {tab === 'gastos' && (
        <GastosTab tripId={trip.id} closed={closed} onAdd={() => navigate(`/viajes/${trip.id}/gastos/nuevo`)} />
      )}
      {tab === 'listas' && <ListasTab trip={trip} closed={closed} />}
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
          title="Pasar a Biko"
          variant="primary"
          confirmLabel="Pasar a Biko"
          loadingLabel="Exportando…"
          loading={exportMutation.isPending}
          message={
            exportPreview.isLoading ? (
              <p>Calculando…</p>
            ) : exportPreview.data && !exportPreview.data.eligible ? (
              <p>{exportPreview.data.reason ?? 'No disponible'}</p>
            ) : (
              <div>
                <p>
                  Se va a registrar tu parte del hogar ({fmtMoney(exportPreview.data?.netShare ?? 0)})
                  bajo Viajes, respetando el mix de categorías.
                </p>
                <ul className="settle-confirm-list">
                  {exportPreview.data?.categoryMix.map((c) => (
                    <li key={c.category}>
                      {c.seedCategoryName}: {fmtMoney(c.amount)} ({c.percent}%)
                    </li>
                  ))}
                </ul>
              </div>
            )
          }
          onConfirm={() => {
            if (exportPreview.data?.eligible) exportMutation.mutate();
            else setExportOpen(false);
          }}
          onCancel={() => setExportOpen(false)}
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

function ResumenTab({
  trip,
  closed,
  onSettle,
  onExport,
  onOpenAlojamiento,
}: {
  trip: TripHub;
  closed: boolean;
  onSettle: () => void;
  onExport?: () => void;
  onOpenAlojamiento: () => void;
}) {
  const slices = useMemo(
    () =>
      trip.categoryTotals.map((c) => ({
        id: c.category,
        name: TRIP_CATEGORY_LABELS[c.category],
        color: TRIP_CATEGORY_COLORS[c.category],
        value: c.total,
      })),
    [trip.categoryTotals],
  );

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

      {slices.length > 0 && (
        <section className="card">
          <h2>Por categoría</h2>
          <div className="pie-chart-wrap">
            <PieChart slices={slices} formatValue={fmtMoney} />
          </div>
          <div className="chart-legend">
            {slices.map((s) => (
              <div key={s.id} className="chart-legend-item">
                <span className="chart-legend-dot" style={{ background: s.color }} />
                {s.name}
                <span className="chart-legend-amount">{fmtMoney(s.value)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="card">
        <h2>Balances</h2>
        <p className="hint">Por grupo del viaje o viajero suelto</p>
        {(trip.balance.perUnit?.length ?? 0) === 0 ? (
          <p className="empty-state">Todavía no hay gastos</p>
        ) : (
          <ul className="list-plain">
            {trip.balance.perUnit.map((u) => (
              <li key={u.unitId} className="row-between list-row">
                <span>
                  {u.displayName}
                  {u.kind === 'HOUSEHOLD' && <span className="hint"> · grupo</span>}
                </span>
                <span className={u.balance >= 0 ? 'balance-pos' : 'balance-neg'}>
                  {u.balance >= 0 ? '+' : ''}
                  {fmtMoney(u.balance)}
                </span>
              </li>
            ))}
          </ul>
        )}

        {trip.balance.transfers.length > 0 && (
          <div className="settle-transfers" style={{ marginTop: 12 }}>
            <p className="field-label">Quién le paga a quién</p>
            {trip.balance.transfers.map((t) => (
              <div key={`${t.fromUnitId}-${t.toUnitId}`} className="settle-transfer">
                <span>
                  <strong>{t.fromName}</strong> → {t.toName}
                  {' · '}
                  <strong>{fmtMoney(t.amount)}</strong>
                </span>
              </div>
            ))}
          </div>
        )}

        {trip.balance.transfers.length === 0 && trip.totalSpent > 0 && (
          <p className="settle-even">Están a mano</p>
        )}
      </section>

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

      {trip.alreadyExported && (
        <p className="hint center">Ya pasado a Biko</p>
      )}
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
            style={{ background: TRIP_CATEGORY_COLORS[e.category] ?? '#ddd' }}
          />
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
  if (type === 'PACK') return 'Traer';
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

function ListasTab({ trip, closed }: { trip: TripHub; closed: boolean }) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<'TODO' | 'PACK_BUY' | 'MINE'>('TODO');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [itemType, setItemType] = useState<'TODO' | 'PACK' | 'BUY'>('TODO');
  const [assignToAll, setAssignToAll] = useState(false);
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);

  const { data: items, isLoading } = useQuery({
    queryKey: ['trips', trip.id, 'list-items'],
    queryFn: () => api<TripListItemRow[]>(`/trips/${trip.id}/list-items`),
  });

  const filtered = useMemo(() => {
    const all = items ?? [];
    if (mode === 'MINE') {
      return all.filter((i) => isMyListItem(i, trip.myMember.id));
    }
    return all.filter((i) =>
      mode === 'TODO' ? i.type === 'TODO' : i.type === 'PACK' || i.type === 'BUY',
    );
  }, [items, mode, trip.myMember.id]);

  const resetForm = (nextMode: typeof mode = mode) => {
    setEditingId(null);
    setTitle('');
    setNotes('');
    setItemType(nextMode === 'PACK_BUY' ? 'PACK' : 'TODO');
    setAssignToAll(false);
    setAssigneeIds([]);
  };

  const startEdit = (item: TripListItemRow) => {
    setEditingId(item.id);
    setTitle(item.title);
    setNotes(item.notes ?? '');
    setItemType(item.type);
    setAssignToAll(item.assignToAll);
    setAssigneeIds(item.assignees.map((m) => m.id));
  };

  const createMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api(`/trips/${trip.id}/list-items`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['trips', trip.id, 'list-items'] });
      resetForm();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ itemId, body }: { itemId: string; body: Record<string, unknown> }) =>
      api(`/trips/${trip.id}/list-items/${itemId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['trips', trip.id, 'list-items'] });
      resetForm();
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ itemId, status }: { itemId: string; status: 'PENDING' | 'DONE' }) =>
      api(`/trips/${trip.id}/list-items/${itemId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['trips', trip.id, 'list-items'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (itemId: string) =>
      api(`/trips/${trip.id}/list-items/${itemId}`, { method: 'DELETE' }),
    onSuccess: (_data, itemId) => {
      void queryClient.invalidateQueries({ queryKey: ['trips', trip.id, 'list-items'] });
      if (editingId === itemId) resetForm();
    },
  });

  const toggleAssignee = (memberId: string) => {
    setAssignToAll(false);
    setAssigneeIds((prev) =>
      prev.includes(memberId) ? prev.filter((id) => id !== memberId) : [...prev, memberId],
    );
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim() || closed) return;
    const body = {
      type: itemType,
      title: title.trim(),
      notes: notes.trim() || null,
      assignToAll,
      assigneeMemberIds: assignToAll ? [] : assigneeIds,
    };
    if (editingId) {
      updateMutation.mutate({ itemId: editingId, body });
      return;
    }
    if (mode === 'MINE') return;
    createMutation.mutate(body);
  };

  const emptyCopy =
    mode === 'TODO'
      ? 'Nada que hacer todavía'
      : mode === 'PACK_BUY'
        ? 'Nada que traer todavía'
        : 'No tenés tareas asignadas';

  const showForm = !closed && (editingId != null || mode !== 'MINE');
  const formBusy = createMutation.isPending || updateMutation.isPending;
  const showTypePicker = editingId != null || mode === 'PACK_BUY';

  return (
    <>
      <div className="segmented segmented-wrap">
        <button
          type="button"
          className={mode === 'TODO' ? 'active' : ''}
          onClick={() => {
            setMode('TODO');
            if (!editingId) resetForm('TODO');
          }}
        >
          Hacer
        </button>
        <button
          type="button"
          className={mode === 'PACK_BUY' ? 'active' : ''}
          onClick={() => {
            setMode('PACK_BUY');
            if (!editingId) resetForm('PACK_BUY');
          }}
        >
          Traer / Comprar
        </button>
        <button
          type="button"
          className={mode === 'MINE' ? 'active' : ''}
          onClick={() => {
            setMode('MINE');
            if (!editingId) resetForm('MINE');
          }}
        >
          Mis tareas
        </button>
      </div>

      {showForm && (
        <form className="card promo-form" onSubmit={onSubmit}>
          {showTypePicker && (
            <div className="segmented">
              {editingId != null && (
                <button
                  type="button"
                  className={itemType === 'TODO' ? 'active' : ''}
                  onClick={() => setItemType('TODO')}
                >
                  Hacer
                </button>
              )}
              <button
                type="button"
                className={itemType === 'PACK' ? 'active' : ''}
                onClick={() => setItemType('PACK')}
              >
                Traer
              </button>
              <button
                type="button"
                className={itemType === 'BUY' ? 'active' : ''}
                onClick={() => setItemType('BUY')}
              >
                Comprar
              </button>
            </div>
          )}
          <label>
            {itemType === 'TODO' ? 'Qué hay que hacer' : 'Ítem'}
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={itemType === 'TODO' ? 'Reservar auto' : 'Protector solar'}
            />
          </label>
          <label>
            Notas
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Opcional"
            />
          </label>
          <div className="listas-assignees">
            <span className="listas-assignees-label">Asignar a</span>
            <div className="chip-row">
              <Chip
                selected={assignToAll}
                onClick={() => {
                  setAssignToAll(true);
                  setAssigneeIds([]);
                }}
              >
                Todos
              </Chip>
              {trip.members.map((m) => (
                <Chip
                  key={m.id}
                  selected={!assignToAll && assigneeIds.includes(m.id)}
                  onClick={() => toggleAssignee(m.id)}
                >
                  {m.displayName}
                </Chip>
              ))}
            </div>
            {!assignToAll && assigneeIds.length === 0 && (
              <span className="hint">Sin asignar</span>
            )}
          </div>
          <div className="listas-form-actions">
            <button type="submit" className="btn-secondary" disabled={!title.trim() || formBusy}>
              {editingId ? 'Guardar' : 'Agregar'}
            </button>
            {editingId && (
              <button type="button" className="btn-link" onClick={() => resetForm()}>
                Cancelar
              </button>
            )}
          </div>
        </form>
      )}

      {isLoading && <p className="hint">Cargando…</p>}
      {!isLoading && filtered.length === 0 && <p className="empty-state">{emptyCopy}</p>}

      {!isLoading && filtered.length > 0 && (
        <div className="card listas-list">
          {filtered.map((item) => {
            const typeLabel = listItemTypeLabel(item.type);
            const assigneeLabel = listItemAssigneeLabel(item);
            const supportParts = [
              mode !== 'TODO' ? typeLabel : null,
              assigneeLabel,
              item.notes ? item.notes : null,
            ].filter(Boolean);

            return (
              <ListItem
                key={item.id}
                className={[
                  item.status === 'DONE' ? 'listas-item-done' : '',
                  editingId === item.id ? 'listas-item-editing' : '',
                ]
                  .filter(Boolean)
                  .join(' ') || undefined}
                leading={
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
                }
                title={item.title}
                support={supportParts.length > 0 ? supportParts.join(' · ') : undefined}
                trailing={
                  !closed ? (
                    <div className="listas-item-actions">
                      <button
                        type="button"
                        className="btn-link"
                        onClick={() => startEdit(item)}
                        aria-label="Editar"
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        className="btn-link"
                        onClick={() => deleteMutation.mutate(item.id)}
                        aria-label="Eliminar"
                      >
                        ✕
                      </button>
                    </div>
                  ) : undefined
                }
              />
            );
          })}
        </div>
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
          <input type="date" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} />
        </label>
        <label>
          Hora check-in
          <input type="time" value={checkInTime} onChange={(e) => setCheckInTime(e.target.value)} />
        </label>
      </div>
      <div className="form-row-2">
        <label>
          Check-out
          <input type="date" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} />
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
  if (m.role === 'ORGANIZER') return 'Organizador';
  if (m.inviteStatus === 'PENDING' && !m.userId) return 'Sin reclamar';
  if (m.inviteStatus === 'JOINED') return 'Unido';
  return 'Pendiente';
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

  const households = trip.households ?? [];
  const householdName = (id: string | null) =>
    id ? households.find((h) => h.id === id)?.name ?? null : null;

  const selected = selectedId ? trip.members.find((m) => m.id === selectedId) ?? null : null;

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['trips', trip.id] });
  };

  const openMember = (m: TripMember) => {
    setSelectedId(m.id);
    setEditName(m.displayName);
    setEditHouseholdId(m.tripHouseholdId ?? '');
    setEditRole(m.role);
    setMemberError(null);
  };

  const closeMember = () => {
    setSelectedId(null);
    setMemberError(null);
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
        {trip.members.map((m) => {
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
                const count = trip.members.filter((m) => m.tripHouseholdId === h.id).length;
                return (
                  <li key={h.id} className="row-between list-row">
                    <span>
                      {h.name}
                      <span className="hint"> · {count} persona{count === 1 ? '' : 's'}</span>
                    </span>
                    <button
                      type="button"
                      className="btn-link"
                      onClick={() => deleteGroup.mutate(h.id)}
                      disabled={deleteGroup.isPending}
                    >
                      Eliminar
                    </button>
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
            </div>
            <div className="md-dialog-actions personas-member-actions">
              {canEdit && isPendingSlot(selected) && (
                <Button
                  type="button"
                  variant="danger-text"
                  disabled={deleteMember.isPending || patchMember.isPending}
                  onClick={() => deleteMember.mutate(selected.id)}
                >
                  {deleteMember.isPending ? 'Quitando…' : 'Quitar'}
                </Button>
              )}
              <span className="personas-member-actions-spacer" />
              <Button type="button" variant="text" disabled={patchMember.isPending} onClick={closeMember}>
                {canEdit ? 'Cancelar' : 'Cerrar'}
              </Button>
              {canEdit && (
                <Button
                  type="button"
                  variant="tonal"
                  disabled={patchMember.isPending || deleteMember.isPending}
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
