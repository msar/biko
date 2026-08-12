import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Button, Chip, Icon } from '../components/ui';
import type { IconName } from '../components/ui/Icon';
import { ApiError, api, fmtDate, fmtMoney } from '../lib/api';
import type {
  TripHub,
  TripItineraryItem,
  TripItineraryItemType,
  TripMealSlot,
} from '../lib/trip-types';
import {
  ARRIVAL_KIND_LABEL,
  eachCalendarDay,
  isGoogleMapsUrl,
  isHttpUrl,
  MEAL_SLOT_LABEL,
  timeInputValue,
  todayYmdInTimeZone,
} from '../lib/trip-utils';

type CreateType = 'MEAL' | 'RESERVATION' | 'ACTIVITY';

function typeLabel(item: TripItineraryItem): string {
  if (item.type === 'MEAL') return MEAL_SLOT_LABEL[item.mealSlot ?? ''] ?? 'Comida';
  if (item.type === 'RESERVATION') {
    const slot = item.mealSlot ? MEAL_SLOT_LABEL[item.mealSlot] : null;
    return slot ? `Reserva · ${slot}` : 'Reserva';
  }
  if (item.type === 'ACTIVITY') return 'Actividad';
  if (item.type === 'ARRIVAL') return ARRIVAL_KIND_LABEL[item.arrivalKind ?? ''] ?? 'Llegada';
  return item.type;
}

function itemIcon(item: TripItineraryItem): IconName {
  if (item.type === 'MEAL') {
    if (item.mealSlot === 'BREAKFAST') return 'restaurant';
    if (item.mealSlot === 'LUNCH') return 'restaurant';
    return 'restaurant';
  }
  if (item.type === 'RESERVATION') return 'menu_book';
  if (item.type === 'ACTIVITY') return 'local_activity';
  if (item.type === 'ARRIVAL') {
    if (item.arrivalKind === 'CHECK_OUT') return 'logout';
    if (item.arrivalKind === 'FLIGHT') return 'flight';
    if (item.arrivalKind === 'CAR') return 'directions_car';
    return 'hotel';
  }
  return 'calendar_month';
}

function itemHeadline(item: TripItineraryItem): string {
  if (item.type === 'MEAL') {
    return item.menu?.trim() || item.title?.trim() || typeLabel(item);
  }
  if (item.type === 'RESERVATION') {
    return item.placeName?.trim() || item.title?.trim() || 'Reserva';
  }
  if (item.type === 'ACTIVITY') {
    return item.title?.trim() || 'Actividad';
  }
  return item.title?.trim() || typeLabel(item);
}

function addDaysYmd(ymd: string, delta: number): string {
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return ymd;
  const cur = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) + delta * 86400000;
  const d = new Date(cur);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function dayStripForTrip(trip: TripHub, selected: string): string[] {
  if (trip.startDate && trip.endDate) {
    const days = eachCalendarDay(trip.startDate, trip.endDate);
    if (days.length > 0) return days;
  }
  const center = selected || todayYmdInTimeZone(trip.destinationTimezone);
  return [-2, -1, 0, 1, 2].map((d) => addDaysYmd(center, d));
}

function shortDayLabel(ymd: string): string {
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return ymd;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12));
  return d.toLocaleDateString('es-AR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

function DetailLine({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <p style={{ margin: '6px 0 0', overflowWrap: 'anywhere' }}>
      <span className="hint">{label}</span>
      <br />
      {value}
    </p>
  );
}

function DetailAddress({ address }: { address: string | null | undefined }) {
  if (!address?.trim()) return null;
  const trimmed = address.trim();
  const maps = isGoogleMapsUrl(trimmed);
  return (
    <p style={{ margin: '6px 0 0', overflowWrap: 'anywhere' }}>
      <span className="hint">Dirección</span>
      <br />
      {maps ? (
        <a href={trimmed} target="_blank" rel="noreferrer">
          Abrir en Maps
        </a>
      ) : isHttpUrl(trimmed) ? (
        <a href={trimmed} target="_blank" rel="noreferrer">
          Abrir enlace
        </a>
      ) : (
        trimmed
      )}
    </p>
  );
}

export function ItineraryItemRow({
  item,
  onOpen,
}: {
  item: TripItineraryItem;
  onOpen: (item: TripItineraryItem) => void;
}) {
  const time = timeInputValue(item.startTime);

  return (
    <li style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      <button
        type="button"
        className="list-row trip-itinerary-row"
        onClick={() => onOpen(item)}
        style={{
          width: '100%',
          textAlign: 'left',
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          display: 'flex',
          gap: 12,
          alignItems: 'flex-start',
          padding: '10px 0',
        }}
      >
        <span
          className="trip-itinerary-icon"
          style={{
            flexShrink: 0,
            width: 36,
            height: 36,
            borderRadius: 10,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--md-sys-color-secondary-container, #cfe8de)',
            color: 'var(--md-sys-color-on-secondary-container, #1e305e)',
          }}
          aria-hidden
        >
          <Icon name={itemIcon(item)} size="sm" />
        </span>
        <span style={{ minWidth: 0, flex: 1 }}>
          <p style={{ margin: 0 }}>
            {time ? <span className="hint">{time} · </span> : null}
            <strong>{itemHeadline(item)}</strong>
          </p>
          <p className="hint" style={{ margin: '2px 0 0' }}>
            {typeLabel(item)}
            {item.type === 'MEAL' && item.inChargeMember
              ? ` · A cargo: ${item.inChargeMember.displayName}`
              : null}
            {item.type === 'ACTIVITY' && item.amount != null && item.amount > 0
              ? ` · ${fmtMoney(item.amount)}`
              : null}
          </p>
        </span>
        <Icon name="chevron_right" size="sm" className="hint" />
      </button>
    </li>
  );
}

function ItineraryDetailDialog({
  item,
  closed,
  onClose,
  onEdit,
  onDelete,
  onOpenAlojamiento,
}: {
  item: TripItineraryItem;
  closed: boolean;
  onClose: () => void;
  onEdit: (item: TripItineraryItem) => void;
  onDelete: (item: TripItineraryItem) => void;
  onOpenAlojamiento?: () => void;
}) {
  const editable = !item.virtual && item.type !== 'ARRIVAL' && !closed;
  const time = timeInputValue(item.startTime);

  return (
    <div className="md-dialog-overlay" role="presentation" onClick={onClose}>
      <div
        className="md-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="itinerary-detail-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="row-between" style={{ gap: 8, alignItems: 'center' }}>
          <span
            style={{
              width: 40,
              height: 40,
              borderRadius: 12,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'var(--md-sys-color-secondary-container, #cfe8de)',
            }}
            aria-hidden
          >
            <Icon name={itemIcon(item)} />
          </span>
          <h2 id="itinerary-detail-title" style={{ margin: 0, flex: 1 }}>
            {itemHeadline(item)}
          </h2>
          <button type="button" className="btn-link" onClick={onClose} aria-label="Cerrar">
            <Icon name="close" />
          </button>
        </div>

        <div className="md-dialog-body">
          <p className="hint" style={{ marginTop: 0 }}>
            {typeLabel(item)}
            {time ? ` · ${time}` : ''}
          </p>
          <DetailLine label="Fecha" value={fmtDate(item.dayDate)} />
          {item.type === 'MEAL' && (
            <>
              <DetailLine label="Menú" value={item.menu} />
              <DetailLine label="A cargo" value={item.inChargeMember?.displayName} />
            </>
          )}
          {item.type === 'RESERVATION' && (
            <>
              <DetailLine
                label="Tipo de comida"
                value={item.mealSlot ? MEAL_SLOT_LABEL[item.mealSlot] : null}
              />
              <DetailAddress address={item.address} />
              {item.link ? (
                <p style={{ margin: '6px 0 0' }}>
                  <span className="hint">Link</span>
                  <br />
                  <a href={item.link} target="_blank" rel="noreferrer">
                    Abrir reserva
                  </a>
                </p>
              ) : null}
            </>
          )}
          {item.type === 'ACTIVITY' && (
            <>
              <DetailLine
                label="Costo"
                value={item.amount != null && item.amount > 0 ? fmtMoney(item.amount) : null}
              />
              <DetailLine label="Lugar" value={item.placeName} />
              <DetailAddress address={item.address} />
              {item.link ? (
                <p style={{ margin: '6px 0 0' }}>
                  <span className="hint">Link</span>
                  <br />
                  <a href={item.link} target="_blank" rel="noreferrer">
                    Ver más
                  </a>
                </p>
              ) : null}
            </>
          )}
          {item.type === 'ARRIVAL' && (
            <>
              <DetailLine label="Lugar" value={item.placeName} />
              <DetailAddress address={item.address} />
            </>
          )}
          <DetailLine label="Notas" value={item.notes} />
        </div>

        <div className="md-dialog-actions" style={{ flexWrap: 'wrap', gap: 8 }}>
          {item.virtual && onOpenAlojamiento ? (
            <Button
              type="button"
              variant="filled"
              onClick={() => {
                onClose();
                onOpenAlojamiento();
              }}
            >
              Ver alojamiento
            </Button>
          ) : null}
          {editable ? (
            <>
              <Button
                type="button"
                variant="tonal"
                onClick={() => {
                  onClose();
                  onEdit(item);
                }}
              >
                Editar
              </Button>
              <Button
                type="button"
                variant="danger-text"
                onClick={() => {
                  if (window.confirm('¿Eliminar este ítem del itinerario?')) {
                    onDelete(item);
                    onClose();
                  }
                }}
              >
                Eliminar
              </Button>
            </>
          ) : null}
          <Button type="button" variant="text" onClick={onClose}>
            Cerrar
          </Button>
        </div>
      </div>
    </div>
  );
}

export function TripItinerarioTab({
  trip,
  closed,
  onOpenAlojamiento,
  initialDate,
}: {
  trip: TripHub;
  closed: boolean;
  onOpenAlojamiento: () => void;
  initialDate?: string;
}) {
  const queryClient = useQueryClient();
  const today = todayYmdInTimeZone(trip.destinationTimezone);
  const [selectedDate, setSelectedDate] = useState(
    () => initialDate || trip.startDate || today,
  );
  const [formOpen, setFormOpen] = useState(false);
  const [detailItem, setDetailItem] = useState<TripItineraryItem | null>(null);
  const [editing, setEditing] = useState<TripItineraryItem | null>(null);
  const [createType, setCreateType] = useState<CreateType>('MEAL');
  const [error, setError] = useState<string | null>(null);

  const [mealSlot, setMealSlot] = useState<TripMealSlot | ''>('BREAKFAST');
  const [menu, setMenu] = useState('');
  const [inChargeMemberId, setInChargeMemberId] = useState('');
  const [title, setTitle] = useState('');
  const [placeName, setPlaceName] = useState('');
  const [address, setAddress] = useState('');
  const [link, setLink] = useState('');
  const [amount, setAmount] = useState('');
  const [startTime, setStartTime] = useState('');
  const [notes, setNotes] = useState('');

  const days = useMemo(() => dayStripForTrip(trip, selectedDate), [trip, selectedDate]);

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['trips', trip.id, 'itinerary', selectedDate],
    queryFn: () =>
      api<TripItineraryItem[]>(
        `/trips/${trip.id}/itinerary?date=${encodeURIComponent(selectedDate)}`,
      ),
  });

  const resetForm = () => {
    setEditing(null);
    setCreateType('MEAL');
    setMealSlot('BREAKFAST');
    setMenu('');
    setInChargeMemberId('');
    setTitle('');
    setPlaceName('');
    setAddress('');
    setLink('');
    setAmount('');
    setStartTime('');
    setNotes('');
    setError(null);
  };

  const openCreate = (type: CreateType) => {
    resetForm();
    setCreateType(type);
    setMealSlot(type === 'RESERVATION' ? '' : 'BREAKFAST');
    setDetailItem(null);
    setFormOpen(true);
  };

  const openEdit = (item: TripItineraryItem) => {
    setEditing(item);
    setCreateType(item.type as CreateType);
    setMealSlot((item.mealSlot as TripMealSlot) || (item.type === 'RESERVATION' ? '' : 'BREAKFAST'));
    setMenu(item.menu ?? '');
    setInChargeMemberId(item.inChargeMemberId ?? '');
    setTitle(item.title ?? '');
    setPlaceName(item.placeName ?? '');
    setAddress(item.address ?? '');
    setLink(item.link ?? '');
    setAmount(item.amount != null ? String(item.amount) : '');
    setStartTime(timeInputValue(item.startTime));
    setNotes(item.notes ?? '');
    setError(null);
    setDetailItem(null);
    setFormOpen(true);
  };

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['trips', trip.id, 'itinerary'] });
    void queryClient.invalidateQueries({ queryKey: ['trips', trip.id] });
    void queryClient.invalidateQueries({ queryKey: ['trips', trip.id, 'expenses'] });
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const parsedAmount =
        amount.trim() === '' ? null : Number(String(amount).replace(',', '.'));
      if (parsedAmount != null && Number.isNaN(parsedAmount)) {
        throw new ApiError(400, 'Costo inválido');
      }

      const activeType: TripItineraryItemType = editing?.type ?? createType;
      const body: Record<string, unknown> = {
        dayDate: selectedDate,
        startTime: startTime || null,
        notes: notes.trim() || null,
      };

      if (activeType === 'MEAL') {
        if (!mealSlot) throw new ApiError(400, 'Indicá desayuno, almuerzo o cena');
        body.mealSlot = mealSlot;
        body.menu = menu.trim() || null;
        body.title = title.trim() || null;
        body.inChargeMemberId = inChargeMemberId || null;
      } else if (activeType === 'RESERVATION') {
        body.placeName = placeName.trim() || title.trim() || null;
        body.title = title.trim() || placeName.trim() || null;
        body.address = address.trim() || null;
        body.link = link.trim() || null;
        body.mealSlot = mealSlot || null;
        body.mealItemId = null;
      } else {
        body.title = title.trim() || null;
        body.amount = parsedAmount;
        body.placeName = placeName.trim() || null;
        body.address = address.trim() || null;
        body.link = link.trim() || null;
      }

      if (editing) {
        return api<TripItineraryItem>(`/trips/${trip.id}/itinerary/${editing.id}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        });
      }
      return api<TripItineraryItem>(`/trips/${trip.id}/itinerary`, {
        method: 'POST',
        body: JSON.stringify({ type: createType, ...body }),
      });
    },
    onSuccess: () => {
      invalidate();
      setFormOpen(false);
      resetForm();
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'No se pudo guardar');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (item: TripItineraryItem) =>
      api(`/trips/${trip.id}/itinerary/${item.id}`, { method: 'DELETE' }),
    onSuccess: () => invalidate(),
  });

  useEffect(() => {
    if (initialDate) setSelectedDate(initialDate);
  }, [initialDate]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    saveMutation.mutate();
  };

  const formType = editing?.type ?? createType;

  return (
    <>
      <div
        className="trip-day-strip"
        style={{ display: 'flex', gap: 8, overflowX: 'auto', marginBottom: 12 }}
      >
        {days.map((d) => (
          <Chip
            key={d}
            selected={d === selectedDate}
            onClick={() => {
              setSelectedDate(d);
              setFormOpen(false);
              setDetailItem(null);
              resetForm();
            }}
          >
            {shortDayLabel(d)}
          </Chip>
        ))}
      </div>

      <p className="hint" style={{ marginTop: 0 }}>
        {fmtDate(selectedDate)}
        {selectedDate === today ? ' · Hoy' : ''}
      </p>

      {!closed && !formOpen && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          <Button type="button" variant="filled" size="sm" onClick={() => openCreate('MEAL')}>
            + Comida
          </Button>
          <Button type="button" variant="tonal" size="sm" onClick={() => openCreate('RESERVATION')}>
            + Reserva
          </Button>
          <Button type="button" variant="tonal" size="sm" onClick={() => openCreate('ACTIVITY')}>
            + Actividad
          </Button>
        </div>
      )}

      {formOpen && (
        <form className="card promo-form" onSubmit={onSubmit} style={{ marginBottom: 12 }}>
          <h2 style={{ marginTop: 0 }}>
            {editing ? 'Editar' : 'Agregar'}{' '}
            {formType === 'MEAL' ? 'comida' : formType === 'RESERVATION' ? 'reserva' : 'actividad'}
          </h2>

          {formType === 'MEAL' && (
            <>
              <label>
                Tipo
                <select
                  value={mealSlot || 'BREAKFAST'}
                  onChange={(e) => setMealSlot(e.target.value as TripMealSlot)}
                  disabled={Boolean(editing)}
                >
                  <option value="BREAKFAST">Desayuno</option>
                  <option value="LUNCH">Almuerzo</option>
                  <option value="DINNER">Cena</option>
                </select>
              </label>
              <label>
                Menú
                <textarea
                  value={menu}
                  onChange={(e) => setMenu(e.target.value)}
                  rows={3}
                  placeholder="Opcional"
                />
              </label>
              <label>
                A cargo
                <select
                  value={inChargeMemberId}
                  onChange={(e) => setInChargeMemberId(e.target.value)}
                >
                  <option value="">Sin asignar</option>
                  {trip.members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.displayName}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}

          {formType === 'RESERVATION' && (
            <>
              <label>
                Restaurante / lugar
                <input
                  value={placeName}
                  onChange={(e) => setPlaceName(e.target.value)}
                  required
                  placeholder="Nombre del lugar"
                />
              </label>
              <label>
                Tipo de comida
                <select
                  value={mealSlot}
                  onChange={(e) => setMealSlot(e.target.value as TripMealSlot | '')}
                >
                  <option value="">Sin especificar</option>
                  <option value="BREAKFAST">Desayuno</option>
                  <option value="LUNCH">Almuerzo</option>
                  <option value="DINNER">Cena</option>
                </select>
              </label>
              <label>
                Dirección
                <input value={address} onChange={(e) => setAddress(e.target.value)} />
              </label>
              <label>
                Link
                <input
                  value={link}
                  onChange={(e) => setLink(e.target.value)}
                  placeholder="https://…"
                />
              </label>
            </>
          )}

          {formType === 'ACTIVITY' && (
            <>
              <label>
                Actividad
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                  placeholder="Tour, museo, show…"
                />
              </label>
              <label>
                Costo ({trip.baseCurrency})
                <input
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="Opcional"
                />
              </label>
              <p className="hint">
                Si hay costo, se registra como gasto de Actividades (reparto igual) y suma a
                balances.
              </p>
              <label>
                Lugar
                <input value={placeName} onChange={(e) => setPlaceName(e.target.value)} />
              </label>
              <label>
                Link
                <input
                  value={link}
                  onChange={(e) => setLink(e.target.value)}
                  placeholder="https://…"
                />
              </label>
            </>
          )}

          <label>
            Hora
            <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          </label>
          <label>
            Notas
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </label>

          {error && <p className="error">{error}</p>}

          <div style={{ display: 'flex', gap: 8 }}>
            <Button type="submit" variant="filled" disabled={saveMutation.isPending}>
              {saveMutation.isPending ? 'Guardando…' : 'Guardar'}
            </Button>
            <Button
              type="button"
              variant="tonal"
              onClick={() => {
                setFormOpen(false);
                resetForm();
              }}
            >
              Cancelar
            </Button>
          </div>
        </form>
      )}

      {isLoading ? (
        <p className="hint">Cargando itinerario…</p>
      ) : items.length === 0 ? (
        <p className="empty-state">Nada planificado este día</p>
      ) : (
        <ul className="list-plain card" style={{ padding: '4px 12px' }}>
          {items.map((item) => (
            <ItineraryItemRow key={item.id} item={item} onOpen={setDetailItem} />
          ))}
        </ul>
      )}

      {detailItem && (
        <ItineraryDetailDialog
          item={detailItem}
          closed={closed}
          onClose={() => setDetailItem(null)}
          onEdit={openEdit}
          onDelete={(it) => deleteMutation.mutate(it)}
          onOpenAlojamiento={onOpenAlojamiento}
        />
      )}
    </>
  );
}

export function ResumenHoyItinerary({
  trip,
  onOpenItinerario,
  onOpenAlojamiento,
}: {
  trip: TripHub;
  onOpenItinerario: () => void;
  onOpenAlojamiento: () => void;
}) {
  const firstDay =
    trip.startDate || todayYmdInTimeZone(trip.destinationTimezone);
  const [detailItem, setDetailItem] = useState<TripItineraryItem | null>(null);
  const { data: items = [], isLoading } = useQuery({
    queryKey: ['trips', trip.id, 'itinerary', firstDay],
    queryFn: () =>
      api<TripItineraryItem[]>(
        `/trips/${trip.id}/itinerary?date=${encodeURIComponent(firstDay)}`,
      ),
  });

  return (
    <section className="card">
      <div className="row-between">
        <h2 style={{ margin: 0 }}>Itinerario</h2>
        <button type="button" className="btn-link" onClick={onOpenItinerario}>
          Ver
        </button>
      </div>
      <p className="hint" style={{ margin: '4px 0 8px' }}>
        {fmtDate(firstDay)}
      </p>
      {isLoading ? (
        <p className="hint">Cargando…</p>
      ) : items.length === 0 ? (
        <p className="empty-state" style={{ margin: 0 }}>
          Nada planificado.{' '}
          <button type="button" className="btn-link" onClick={onOpenItinerario}>
            Planificar
          </button>
        </p>
      ) : (
        <ul className="list-plain" style={{ margin: 0 }}>
          {items.map((item) => (
            <ItineraryItemRow key={item.id} item={item} onOpen={setDetailItem} />
          ))}
        </ul>
      )}

      {detailItem && (
        <ItineraryDetailDialog
          item={detailItem}
          closed
          onClose={() => setDetailItem(null)}
          onEdit={() => {
            setDetailItem(null);
            onOpenItinerario();
          }}
          onDelete={() => setDetailItem(null)}
          onOpenAlojamiento={onOpenAlojamiento}
        />
      )}
    </section>
  );
}
