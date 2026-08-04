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
  dateInputValue,
  mapsUrl,
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
                <li key={`${t.fromMemberId}-${t.toMemberId}`}>
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
        {trip.balance.perMember.length === 0 ? (
          <p className="empty-state">Todavía no hay gastos</p>
        ) : (
          <ul className="list-plain">
            {trip.balance.perMember.map((m) => (
              <li key={m.memberId} className="row-between list-row">
                <span>{m.displayName}</span>
                <span className={m.balance >= 0 ? 'balance-pos' : 'balance-neg'}>
                  {m.balance >= 0 ? '+' : ''}
                  {fmtMoney(m.balance)}
                </span>
              </li>
            ))}
          </ul>
        )}

        {trip.balance.transfers.length > 0 && (
          <div className="settle-transfers" style={{ marginTop: 12 }}>
            <p className="field-label">Quién le paga a quién</p>
            {trip.balance.transfers.map((t) => (
              <div key={`${t.fromMemberId}-${t.toMemberId}`} className="settle-transfer">
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
        <div key={e.id} className="card expense-row">
          <div className="row-between">
            <strong>{TRIP_CATEGORY_LABELS[e.category]}</strong>
            <strong>{fmtMoney(e.amount)}</strong>
          </div>
          <p className="hint">
            Pagó {e.paidByMember.displayName} · {fmtDate(e.date)}
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
  const [editing, setEditing] = useState(!acc);
  const [label, setLabel] = useState(acc?.label ?? '');
  const [address, setAddress] = useState(acc?.address ?? '');
  const [checkIn, setCheckIn] = useState(dateInputValue(acc?.checkIn));
  const [checkOut, setCheckOut] = useState(dateInputValue(acc?.checkOut));
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
    saveMutation.mutate({
      label: label.trim() || null,
      address: address.trim() || null,
      checkIn: checkIn || null,
      checkOut: checkOut || null,
      link: link.trim() || null,
      notes: notes.trim() || null,
    });
  };

  if (!editing && acc) {
    return (
      <section className="card">
        <h2>{acc.label || 'Alojamiento'}</h2>
        {acc.address && (
          <p>
            <a href={mapsUrl(acc.address)} target="_blank" rel="noreferrer">
              {acc.address}
            </a>
          </p>
        )}
        {(acc.checkIn || acc.checkOut) && (
          <p className="hint">
            Check-in {acc.checkIn ? fmtDate(acc.checkIn) : '—'} · Check-out{' '}
            {acc.checkOut ? fmtDate(acc.checkOut) : '—'}
          </p>
        )}
        {acc.link && (
          <p>
            <a href={acc.link} target="_blank" rel="noreferrer">
              Ver reserva
            </a>
          </p>
        )}
        {acc.notes && <p className="hint">{acc.notes}</p>}
        {!closed && (
          <button type="button" className="btn-secondary" onClick={() => setEditing(true)}>
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
        Dirección
        <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Calle 123" />
      </label>
      <div className="form-row-2">
        <label>
          Check-in
          <input type="date" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} />
        </label>
        <label>
          Check-out
          <input type="date" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} />
        </label>
      </div>
      <label>
        Link
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
  return (
    <>
      <section className="card">
        <h2>Personas</h2>
        <ul className="list-plain">
          {trip.members.map((m) => (
            <li key={m.id} className="row-between list-row">
              <span>
                {m.displayName}
                {m.role === 'ORGANIZER' && <span className="hint"> · Organizador</span>}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {inviteLink && trip.isOrganizer && trip.status !== 'CLOSED' && (
        <section className="card">
          <h2>Invitar</h2>
          <p className="hint">Compartí el link. Quien entre se suma al viaje, no al hogar.</p>
          <code className="trip-invite-code">{inviteLink}</code>
          <button type="button" className="btn-secondary" onClick={onCopy}>
            {copied ? '¡Copiado!' : 'Copiar link'}
          </button>
        </section>
      )}

      {!inviteLink && trip.members.length < 2 && (
        <p className="empty-state">Invitá al grupo con el link</p>
      )}
    </>
  );
}
