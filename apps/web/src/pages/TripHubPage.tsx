import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import ConfirmDialog from '../components/ConfirmDialog';
import PieChart from '../components/charts/PieChart';
import { api, fmtDate, fmtMoney } from '../lib/api';
import type {
  TripExpense,
  TripExportPreview,
  TripHub,
  TripListItemRow,
} from '../lib/trip-types';
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

export default function TripHubPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<HubTab>('resumen');
  const [settleOpen, setSettleOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [copied, setCopied] = useState(false);

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
    enabled: Boolean(id) && exportOpen,
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
        <Link to="/viajes">← Volver a Viajes</Link>
      </div>
    );
  }

  const closed = trip.status === 'CLOSED';
  const inviteLink = trip.inviteCode ? tripInviteUrl(trip.inviteCode) : null;

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
        <Link to="/viajes" className="icon-btn" aria-label="Volver">
          ←
        </Link>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ margin: 0 }}>{trip.name}</h1>
          <p className="hint" style={{ margin: 0 }}>
            {trip.destination ? `${trip.destination} · ` : ''}
            {TRIP_STATUS_LABEL[trip.status]}
          </p>
        </div>
        <span />
      </header>

      <div className="segmented trip-hub-tabs">
        {(
          [
            ['resumen', 'Resumen'],
            ['gastos', 'Gastos'],
            ['listas', 'Listas'],
            ['alojamiento', 'Alojamiento'],
            ['personas', 'Personas'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={tab === key ? 'active' : ''}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'resumen' && (
        <ResumenTab
          trip={trip}
          closed={closed}
          onSettle={() => setSettleOpen(true)}
          onExport={() => setExportOpen(true)}
        />
      )}
      {tab === 'gastos' && (
        <GastosTab tripId={trip.id} closed={closed} onAdd={() => navigate(`/viajes/${trip.id}/gastos/nuevo`)} />
      )}
      {tab === 'listas' && <ListasTab trip={trip} closed={closed} />}
      {tab === 'alojamiento' && <AlojamientoTab trip={trip} closed={closed} />}
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
    </div>
  );
}

function ResumenTab({
  trip,
  closed,
  onSettle,
  onExport,
}: {
  trip: TripHub;
  closed: boolean;
  onSettle: () => void;
  onExport: () => void;
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

  return (
    <>
      <section className="hero-card">
        <p className="hint">Total del viaje</p>
        <p className="hero-amount">{fmtMoney(trip.totalSpent)}</p>
        {(trip.startDate || trip.endDate) && (
          <p className="hint">
            {trip.startDate ? fmtDate(trip.startDate) : '—'}
            {' → '}
            {trip.endDate ? fmtDate(trip.endDate) : '—'}
          </p>
        )}
      </section>

      {slices.length > 0 && (
        <section className="card">
          <h2>Por categoría</h2>
          <PieChart slices={slices} formatValue={fmtMoney} />
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
                </span>
                <strong>{fmtMoney(t.amount)}</strong>
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

      {trip.canExport && (
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
          className="card expense-row expense-row-interactive"
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
          <div className="row-between">
            <strong>{TRIP_CATEGORY_LABELS[e.category]}</strong>
            <strong>{fmtMoney(e.amount)}</strong>
          </div>
          <p className="hint">
            {formatTripExpensePayers(e, fmtMoney)} · {fmtDate(e.date)}
          </p>
          {e.note && <p className="hint">{e.note}</p>}
        </div>
      ))}
    </>
  );
}

function ListasTab({ trip, closed }: { trip: TripHub; closed: boolean }) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<'TODO' | 'PACK_BUY'>('TODO');
  const [title, setTitle] = useState('');
  const [packType, setPackType] = useState<'PACK' | 'BUY'>('PACK');
  const [assigneeId, setAssigneeId] = useState('');

  const { data: items, isLoading } = useQuery({
    queryKey: ['trips', trip.id, 'list-items'],
    queryFn: () => api<TripListItemRow[]>(`/trips/${trip.id}/list-items`),
  });

  const filtered = (items ?? []).filter((i) =>
    mode === 'TODO' ? i.type === 'TODO' : i.type === 'PACK' || i.type === 'BUY',
  );

  const createMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api(`/trips/${trip.id}/list-items`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['trips', trip.id, 'list-items'] });
      setTitle('');
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
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['trips', trip.id, 'list-items'] });
    },
  });

  const onAdd = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim() || closed) return;
    createMutation.mutate({
      type: mode === 'TODO' ? 'TODO' : packType,
      title: title.trim(),
      assigneeMemberId: assigneeId || null,
    });
  };

  return (
    <>
      <div className="segmented">
        <button type="button" className={mode === 'TODO' ? 'active' : ''} onClick={() => setMode('TODO')}>
          Hacer
        </button>
        <button
          type="button"
          className={mode === 'PACK_BUY' ? 'active' : ''}
          onClick={() => setMode('PACK_BUY')}
        >
          Traer / Comprar
        </button>
      </div>

      {!closed && (
        <form className="card promo-form" onSubmit={onAdd}>
          {mode === 'PACK_BUY' && (
            <div className="segmented">
              <button
                type="button"
                className={packType === 'PACK' ? 'active' : ''}
                onClick={() => setPackType('PACK')}
              >
                Traer
              </button>
              <button
                type="button"
                className={packType === 'BUY' ? 'active' : ''}
                onClick={() => setPackType('BUY')}
              >
                Comprar
              </button>
            </div>
          )}
          <label>
            {mode === 'TODO' ? 'Qué hay que hacer' : 'Ítem'}
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={mode === 'TODO' ? 'Reservar auto' : 'Protector solar'}
            />
          </label>
          {mode === 'PACK_BUY' && (
            <label>
              Asignar a
              <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
                <option value="">Sin asignar</option>
                {trip.members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button type="submit" className="btn-secondary" disabled={!title.trim()}>
            Agregar
          </button>
        </form>
      )}

      {isLoading && <p className="hint">Cargando…</p>}
      {!isLoading && filtered.length === 0 && (
        <p className="empty-state">
          {mode === 'TODO' ? 'Nada que hacer todavía' : 'Nada que traer todavía'}
        </p>
      )}

      {filtered.map((item) => (
        <div key={item.id} className="card row-between" style={{ alignItems: 'flex-start' }}>
          <label style={{ display: 'flex', gap: 10, flex: 1, cursor: closed ? 'default' : 'pointer' }}>
            <input
              type="checkbox"
              checked={item.status === 'DONE'}
              disabled={closed}
              onChange={() =>
                toggleMutation.mutate({
                  itemId: item.id,
                  status: item.status === 'DONE' ? 'PENDING' : 'DONE',
                })
              }
            />
            <span>
              <span style={{ textDecoration: item.status === 'DONE' ? 'line-through' : undefined }}>
                {item.title}
              </span>
              {(item.type === 'PACK' || item.type === 'BUY') && (
                <span className="hint"> · {item.type === 'PACK' ? 'Traer' : 'Comprar'}</span>
              )}
              {item.assigneeMember && (
                <span className="hint"> · {item.assigneeMember.displayName}</span>
              )}
            </span>
          </label>
          {!closed && (
            <button
              type="button"
              className="btn-link"
              onClick={() => deleteMutation.mutate(item.id)}
              aria-label="Eliminar"
            >
              ✕
            </button>
          )}
        </div>
      ))}
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
  const [newName, setNewName] = useState('');
  const [newGroupName, setNewGroupName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const households = trip.households ?? [];
  const householdName = (id: string | null) =>
    id ? households.find((h) => h.id === id)?.name ?? null : null;

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['trips', trip.id] });
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
    onSuccess: invalidate,
    onError: (err) => setError(err instanceof Error ? err.message : 'No se pudo eliminar'),
  });

  const patchMember = useMutation({
    mutationFn: ({
      memberId,
      tripHouseholdId,
    }: {
      memberId: string;
      tripHouseholdId: string | null;
    }) =>
      api(`/trips/${trip.id}/members/${memberId}`, {
        method: 'PATCH',
        body: JSON.stringify({ tripHouseholdId }),
      }),
    onSuccess: invalidate,
    onError: (err) => setError(err instanceof Error ? err.message : 'No se pudo asignar'),
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

  return (
    <>
      <section className="card">
        <h2>Personas</h2>
        <ul className="list-plain">
          {trip.members.map((m) => {
            const group = householdName(m.tripHouseholdId);
            const pending = m.inviteStatus === 'PENDING' && !m.userId;
            return (
              <li key={m.id} className="list-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
                <div className="row-between">
                  <span>
                    {m.displayName}
                    {m.role === 'ORGANIZER' && <span className="hint"> · Organizador</span>}
                    {pending && <span className="hint"> · Sin reclamar</span>}
                    {!pending && m.inviteStatus === 'JOINED' && m.role !== 'ORGANIZER' && (
                      <span className="hint"> · Unido</span>
                    )}
                  </span>
                  {trip.isOrganizer && !closed && pending && (
                    <button
                      type="button"
                      className="btn-link"
                      onClick={() => deleteMember.mutate(m.id)}
                      disabled={deleteMember.isPending}
                    >
                      Quitar
                    </button>
                  )}
                </div>
                {group && <span className="hint">Grupo: {group}</span>}
                {trip.isOrganizer && !closed && (
                  <label className="hint" style={{ display: 'block' }}>
                    Asignar a grupo
                    <select
                      value={m.tripHouseholdId ?? ''}
                      onChange={(e) =>
                        patchMember.mutate({
                          memberId: m.id,
                          tripHouseholdId: e.target.value || null,
                        })
                      }
                      disabled={patchMember.isPending}
                    >
                      <option value="">Sin grupo</option>
                      {households.map((h) => (
                        <option key={h.id} value={h.id}>
                          {h.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </li>
            );
          })}
        </ul>
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
    </>
  );
}
