import { useEffect, useMemo, useState } from 'react';
import PieChart from './charts/PieChart';
import { Chip, SegmentedButton } from './ui';
import { fmtMoney } from '../lib/api';
import type { TripCategorySpendByParty, TripCategoryTotal, TripHub } from '../lib/trip-types';
import { TRIP_CATEGORY_COLORS, TRIP_CATEGORY_LABELS, tripMemberOwes } from '../lib/trip-utils';

type SpendView = 'category' | 'person' | 'group';

const ALL_PARTIES = '__all__';

const PARTY_COLORS = ['#4a7fb5', '#4f8a5b', '#b5567a', '#8a5b9e', '#c47a3a', '#5b8a9e', '#3d6f9e', '#888888'];

function partyColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return PARTY_COLORS[hash % PARTY_COLORS.length]!;
}

function categorySlices(rows: TripCategoryTotal[]) {
  return rows.map((c) => ({
    id: c.category,
    name: TRIP_CATEGORY_LABELS[c.category],
    color: TRIP_CATEGORY_COLORS[c.category],
    value: c.total,
  }));
}

function partySlices(parties: TripCategorySpendByParty[]) {
  return parties
    .filter((p) => p.total > 0)
    .map((p) => ({
      id: p.id,
      name: p.displayName,
      color: partyColor(p.id),
      value: p.total,
    }));
}

export default function TripSpendSummary({ trip }: { trip: TripHub }) {
  return (
    <>
      <CategorySpendCard trip={trip} />
      <TripBalancesCard trip={trip} />
    </>
  );
}

function CategorySpendCard({ trip }: { trip: TripHub }) {
  const byMember = trip.categoryTotalsByMember ?? [];
  const byUnit = trip.categoryTotalsByUnit ?? [];
  const hasGroups = (trip.households ?? []).length > 0;
  const [view, setView] = useState<SpendView>('category');
  const [selectedId, setSelectedId] = useState(ALL_PARTIES);

  const parties = view === 'person' ? byMember : view === 'group' ? byUnit : [];

  useEffect(() => {
    if (view === 'group' && !hasGroups) setView('category');
  }, [view, hasGroups]);

  useEffect(() => {
    if (view === 'category' || selectedId === ALL_PARTIES) return;
    if (!parties.some((p) => p.id === selectedId)) setSelectedId(ALL_PARTIES);
  }, [view, parties, selectedId]);

  const selected = parties.find((p) => p.id === selectedId) ?? null;
  const showingParties = view !== 'category' && selectedId === ALL_PARTIES;
  const slices = useMemo(() => {
    if (view === 'category') return categorySlices(trip.categoryTotals);
    const list = view === 'person' ? byMember : byUnit;
    if (selectedId === ALL_PARTIES) return partySlices(list);
    const party = list.find((p) => p.id === selectedId);
    return categorySlices(party?.categories ?? []);
  }, [view, trip.categoryTotals, byMember, byUnit, selectedId]);

  if (trip.categoryTotals.length === 0 && byMember.every((p) => p.total === 0)) {
    return null;
  }

  const options: Array<{ id: SpendView; label: string }> = [
    { id: 'category', label: 'Categoría' },
    { id: 'person', label: 'Persona' },
    ...(hasGroups ? [{ id: 'group' as const, label: 'Grupo' }] : []),
  ];

  const changeView = (next: SpendView) => {
    setView(next);
    setSelectedId(ALL_PARTIES);
  };

  return (
    <section className="card">
      <h2>Por categoría</h2>
      <SegmentedButton
        options={options}
        value={hasGroups || view !== 'group' ? view : 'category'}
        onChange={changeView}
        label="Ver gastos por"
        className="trip-spend-toggle"
      />
      {view !== 'category' && parties.length > 0 && (
        <div className="chip-row trip-spend-picker">
          <Chip selected={selectedId === ALL_PARTIES} onClick={() => setSelectedId(ALL_PARTIES)}>
            {view === 'group' ? 'Todos los grupos' : 'Todos'}
          </Chip>
          {parties.map((p) => (
            <Chip key={p.id} selected={selectedId === p.id} onClick={() => setSelectedId(p.id)}>
              {p.displayName}
            </Chip>
          ))}
        </div>
      )}
      {view !== 'category' && (
        <p className="hint trip-spend-scope-hint">
          {showingParties
            ? view === 'group'
              ? 'Cuánto gastó cada grupo'
              : 'Cuánto gastó cada persona'
            : selected
              ? `${selected.kind === 'HOUSEHOLD' ? 'Gastó el grupo' : 'Gastó'} ${selected.displayName}: ${fmtMoney(selected.total)}`
              : null}
        </p>
      )}
      {slices.length > 0 ? (
        <>
          <div className="pie-chart-wrap">
            <PieChart
              slices={slices}
              formatValue={fmtMoney}
              selectedId={showingParties ? null : undefined}
              onSelect={
                showingParties
                  ? (id) => {
                      if (id) setSelectedId(id);
                    }
                  : undefined
              }
            />
          </div>
          <div className="chart-legend">
            {slices.map((s) => {
              const body = (
                <>
                  <span className="chart-legend-dot" style={{ background: s.color }} />
                  {s.name}
                  <span className="chart-legend-amount">{fmtMoney(s.value)}</span>
                </>
              );
              if (showingParties) {
                return (
                  <button
                    key={s.id}
                    type="button"
                    className="chart-legend-item chart-legend-toggle"
                    onClick={() => setSelectedId(s.id)}
                  >
                    {body}
                  </button>
                );
              }
              return (
                <div key={s.id} className="chart-legend-item">
                  {body}
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <p className="empty-state">Sin gastos en esta vista</p>
      )}
    </section>
  );
}

function TripBalancesCard({ trip }: { trip: TripHub }) {
  const perMember = trip.balance.perMember ?? [];
  const perUnit = trip.balance.perUnit ?? [];
  const memberById = useMemo(
    () => new Map(perMember.map((m) => [m.memberId, m])),
    [perMember],
  );
  const memberOwes = useMemo(() => tripMemberOwes(perMember), [perMember]);
  const hasHouseholds = perUnit.some((u) => u.kind === 'HOUSEHOLD');

  return (
    <section className="card">
      <h2>Gastos y balances</h2>
      <p className="hint">Gastado, pagado y quién le debe a quién</p>
      {perUnit.length === 0 ? (
        <p className="empty-state">Todavía no hay gastos</p>
      ) : (
        <ul className="list-plain">
          {perUnit.map((u) => {
            const householdMembers =
              u.kind === 'HOUSEHOLD'
                ? u.memberIds
                    .map((id) => memberById.get(id))
                    .filter((m): m is NonNullable<typeof m> => Boolean(m))
                    .sort((a, b) =>
                      a.displayName.localeCompare(b.displayName, 'es', { sensitivity: 'base' }),
                    )
                : [];
            return (
              <li key={u.unitId} className="trip-spend-unit">
                <div className="row-between">
                  <span>
                    {u.displayName}
                    {u.kind === 'HOUSEHOLD' && <span className="hint"> · grupo</span>}
                  </span>
                  <span className={u.balance >= 0 ? 'balance-pos' : 'balance-neg'}>
                    {u.balance >= 0 ? '+' : ''}
                    {fmtMoney(u.balance)}
                  </span>
                </div>
                <p className="trip-spend-figures">
                  Gastado {fmtMoney(u.share)} · Pagó {fmtMoney(u.paid)}
                </p>
                {householdMembers.map((m) => (
                  <div key={m.memberId} className="trip-spend-member">
                    <div className="row-between">
                      <span>{m.displayName}</span>
                      <span className={m.balance >= 0 ? 'balance-pos' : 'balance-neg'}>
                        {m.balance >= 0 ? '+' : ''}
                        {fmtMoney(m.balance)}
                      </span>
                    </div>
                    <p className="trip-spend-figures">
                      Gastó {fmtMoney(m.share)} · Pagó {fmtMoney(m.paid)}
                    </p>
                  </div>
                ))}
              </li>
            );
          })}
        </ul>
      )}

      {memberOwes.length > 0 && (
        <div className="settle-transfers">
          <p className="field-label">Quién le debe a quién</p>
          {memberOwes.map((t) => (
            <div key={`${t.fromMemberId}-${t.toMemberId}`} className="settle-transfer">
              <span>
                <strong>{t.fromName}</strong> le debe a <strong>{t.toName}</strong>
                {' · '}
                <strong>{fmtMoney(t.amount)}</strong>
              </span>
            </div>
          ))}
        </div>
      )}

      {hasHouseholds && trip.balance.transfers.length > 0 && (
        <div className="settle-transfers">
          <p className="field-label">Entre grupos (para liquidar)</p>
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

      {memberOwes.length === 0 && trip.balance.transfers.length === 0 && trip.totalSpent > 0 && (
        <p className="settle-even">Están a mano</p>
      )}
    </section>
  );
}
