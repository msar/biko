import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Button, Chip } from '../components/ui';
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
  MEAL_SLOT_LABEL,
  timeInputValue,
  todayYmdInTimeZone,
} from '../lib/trip-utils';

type CreateType = 'MEAL' | 'RESERVATION' | 'ACTIVITY';

function typeLabel(item: TripItineraryItem): string {
  if (item.type === 'MEAL') return MEAL_SLOT_LABEL[item.mealSlot ?? ''] ?? 'Comida';
  if (item.type === 'RESERVATION') return 'Reserva';
  if (item.type === 'ACTIVITY') return 'Actividad';
  if (item.type === 'ARRIVAL') return ARRIVAL_KIND_LABEL[item.arrivalKind ?? ''] ?? 'Llegada';
  return item.type;
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
  return d.toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

export function ItineraryItemRow({
  item,
  closed,
  onEdit,
  onDelete,
  onOpenAlojamiento,
}: {
  item: TripItineraryItem;
  closed: boolean;
  onEdit?: (item: TripItineraryItem) => void;
  onDelete?: (item: TripItineraryItem) => void;
  onOpenAlojamiento?: () => void;
}) {
  const time = timeInputValue(item.startTime);
  const editable = !item.virtual && item.type !== 'ARRIVAL' && !closed;

  return (
    <li className="list-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
      <div className="row-between" style={{ gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <p style={{ margin: 0 }}>
            {time ? <span className="hint">{time} · </span> : null}
            <strong>{itemHeadline(item)}</strong>
          </p>
          <p className="hint" style={{ margin: '2px 0 0' }}>
            {typeLabel(item)}
            {item.type === 'MEAL' && item.inChargeMember
              ? ` · A cargo: ${item.inChargeMember.displayName}`
              : null}
            {item.type === 'RESERVATION' && item.mealItem
              ? ` · ${MEAL_SLOT_LABEL[item.mealItem.mealSlot ?? ''] ?? 'Comida'}`
              : null}
            {item.type === 'ACTIVITY' && item.amount != null && item.amount > 0
              ? ` · ${fmtMoney(item.amount)}`
              : null}
          </p>
          {item.type === 'MEAL' && item.menu && item.menu !== itemHeadline(item) && (
            <p className="hint" style={{ margin: '2px 0 0' }}>
              {item.menu}
            </p>
          )}
          {item.type === 'RESERVATION' && item.address && (
            <p className="hint" style={{ margin: '2px 0 0' }}>
              {item.address}
            </p>
          )}
          {item.type === 'ARRIVAL' && (item.placeName || item.notes) && (
            <p className="hint" style={{ margin: '2px 0 0' }}>
              {item.placeName || item.notes}
            </p>
          )}
        </div>
        {item.virtual && onOpenAlojamiento ? (
          <button type="button" className="btn-link" onClick={onOpenAlojamiento}>
            Alojamiento
          </button>
        ) : null}
      </div>
      {editable && (
        <div className="row-between" style={{ gap: 8 }}>
          <button type="button" className="btn-link" onClick={() => onEdit?.(item)}>
            Editar
          </button>
          <button type="button" className="btn-link" onClick={() => onDelete?.(item)}>
            Eliminar
          </button>
        </div>
      )}
    </li>
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
  const [editing, setEditing] = useState<TripItineraryItem | null>(null);
  const [createType, setCreateType] = useState<CreateType>('MEAL');
  const [error, setError] = useState<string | null>(null);

  const [mealSlot, setMealSlot] = useState<TripMealSlot>('BREAKFAST');
  const [menu, setMenu] = useState('');
  const [inChargeMemberId, setInChargeMemberId] = useState('');
  const [title, setTitle] = useState('');
  const [placeName, setPlaceName] = useState('');
  const [address, setAddress] = useState('');
  const [link, setLink] = useState('');
  const [mealItemId, setMealItemId] = useState('');
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

  const mealsForDay = useMemo(
    () => items.filter((i) => i.type === 'MEAL' && !i.virtual),
    [items],
  );

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
    setMealItemId('');
    setAmount('');
    setStartTime('');
    setNotes('');
    setError(null);
  };

  const openCreate = (type: CreateType) => {
    resetForm();
    setCreateType(type);
    setFormOpen(true);
  };

  const openEdit = (item: TripItineraryItem) => {
    setEditing(item);
    setCreateType(item.type as CreateType);
    setMealSlot((item.mealSlot as TripMealSlot) || 'BREAKFAST');
    setMenu(item.menu ?? '');
    setInChargeMemberId(item.inChargeMemberId ?? '');
    setTitle(item.title ?? '');
    setPlaceName(item.placeName ?? '');
    setAddress(item.address ?? '');
    setLink(item.link ?? '');
    setMealItemId(item.mealItemId ?? '');
    setAmount(item.amount != null ? String(item.amount) : '');
    setStartTime(timeInputValue(item.startTime));
    setNotes(item.notes ?? '');
    setError(null);
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
        body.mealSlot = mealSlot;
        body.menu = menu.trim() || null;
        body.title = title.trim() || null;
        body.inChargeMemberId = inChargeMemberId || null;
      } else if (activeType === 'RESERVATION') {
        body.placeName = placeName.trim() || title.trim() || null;
        body.title = title.trim() || placeName.trim() || null;
        body.address = address.trim() || null;
        body.link = link.trim() || null;
        body.mealItemId = mealItemId || null;
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
      <div className="trip-day-strip" style={{ display: 'flex', gap: 8, overflowX: 'auto', marginBottom: 12 }}>
        {days.map((d) => (
          <Chip
            key={d}
            selected={d === selectedDate}
            onClick={() => {
              setSelectedDate(d);
              setFormOpen(false);
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

      {isLoading ? (
        <p className="hint">Cargando itinerario…</p>
      ) : items.length === 0 ? (
        <p className="empty-state">Nada planificado este día</p>
      ) : (
        <ul className="list-plain card" style={{ padding: '8px 12px' }}>
          {items.map((item) => (
            <ItineraryItemRow
              key={item.id}
              item={item}
              closed={closed}
              onEdit={openEdit}
              onDelete={(it) => {
                if (window.confirm('¿Eliminar este ítem del itinerario?')) {
                  deleteMutation.mutate(it);
                }
              }}
              onOpenAlojamiento={onOpenAlojamiento}
            />
          ))}
        </ul>
      )}

      {!closed && !formOpen && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
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
        <form className="card promo-form" onSubmit={onSubmit} style={{ marginTop: 12 }}>
          <h2 style={{ marginTop: 0 }}>
            {editing ? 'Editar' : 'Agregar'}{' '}
            {formType === 'MEAL' ? 'comida' : formType === 'RESERVATION' ? 'reserva' : 'actividad'}
          </h2>

          {formType === 'MEAL' && (
            <>
              <label>
                Tipo
                <select
                  value={mealSlot}
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
                Dirección
                <input value={address} onChange={(e) => setAddress(e.target.value)} />
              </label>
              <label>
                Link
                <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…" />
              </label>
              <label>
                Comida vinculada
                <select value={mealItemId} onChange={(e) => setMealItemId(e.target.value)}>
                  <option value="">Ninguna</option>
                  {mealsForDay
                    .filter((m) => !editing || m.id !== editing.id)
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {MEAL_SLOT_LABEL[m.mealSlot ?? ''] ?? 'Comida'}
                        {m.menu ? ` — ${m.menu.slice(0, 40)}` : ''}
                      </option>
                    ))}
                </select>
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
                <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…" />
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
  const today = todayYmdInTimeZone(trip.destinationTimezone);
  const { data: items = [], isLoading } = useQuery({
    queryKey: ['trips', trip.id, 'itinerary', today],
    queryFn: () =>
      api<TripItineraryItem[]>(`/trips/${trip.id}/itinerary?date=${encodeURIComponent(today)}`),
  });

  return (
    <section className="card">
      <div className="row-between">
        <h2 style={{ margin: 0 }}>Hoy</h2>
        <button type="button" className="btn-link" onClick={onOpenItinerario}>
          Itinerario
        </button>
      </div>
      <p className="hint" style={{ margin: '4px 0 8px' }}>
        {fmtDate(today)}
      </p>
      {isLoading ? (
        <p className="hint">Cargando…</p>
      ) : items.length === 0 ? (
        <p className="empty-state" style={{ margin: 0 }}>
          Nada para hoy.{' '}
          <button type="button" className="btn-link" onClick={onOpenItinerario}>
            Planificar
          </button>
        </p>
      ) : (
        <ul className="list-plain" style={{ margin: 0 }}>
          {items.map((item) => (
            <ItineraryItemRow
              key={item.id}
              item={item}
              closed
              onOpenAlojamiento={onOpenAlojamiento}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
