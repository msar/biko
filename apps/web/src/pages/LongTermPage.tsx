import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import ChartTooltip from '../components/charts/ChartTooltip';
import PieChart from '../components/charts/PieChart';
import StackedBars, { shortMonth, type SegmentSelectPayload } from '../components/charts/StackedBars';
import ConfirmDialog from '../components/ConfirmDialog';
import ScopeTabs from '../components/ScopeTabs';
import { api, fmtARS, fmtDate } from '../lib/api';
import type { DashboardScope, HouseholdSettlement, LongTermDashboard } from '../lib/types';

const FALLBACK_COLORS = ['#1e305e', '#00a8b5', '#e8b93c', '#b3423f', '#10683f', '#7b5ea7', '#d97742', '#4a90d9'];

type ChartMode = 'bars' | 'pie';

interface TooltipState {
  title: string;
  value: string;
  meta?: string;
}

function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const raw = new Date(y!, m! - 1, 1).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

/** Compact ARS for crowded bar labels: $1.2M / $689k / $450. */
function fmtCompact(n: number): string {
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return `$${m >= 10 ? m.toFixed(0) : m.toFixed(1)}M`;
  }
  if (n >= 10_000) return `$${Math.round(n / 1000)}k`;
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return fmtARS.format(n);
}

function monthTotal(byMonth: Array<{ month: string; total: number }>, month: string | null): number {
  if (!month) return byMonth.reduce((sum, b) => sum + b.total, 0);
  return byMonth.find((b) => b.month === month)?.total ?? 0;
}

function pctOf(part: number, total: number): string {
  if (total <= 0) return '0%';
  return `${Math.round((part / total) * 100)}%`;
}

export default function LongTermPage() {
  const queryClient = useQueryClient();
  const [scope, setScope] = useState<DashboardScope>('household');
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [chartMode, setChartMode] = useState<ChartMode>('bars');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [confirmSettle, setConfirmSettle] = useState(false);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard', 'long-term', 12, scope],
    queryFn: () => api<LongTermDashboard>(`/dashboard/long-term?months=12&scope=${scope}`),
  });

  const settleMutation = useMutation({
    mutationFn: () =>
      api<{
        settlements: HouseholdSettlement[];
        balance: LongTermDashboard['balance'];
      }>('/settlements', { method: 'POST', body: JSON.stringify({}) }),
    onSuccess: () => {
      setConfirmSettle(false);
      void queryClient.invalidateQueries({ queryKey: ['dashboard', 'long-term'] });
    },
  });

  useEffect(() => {
    setSelectedMonth(null);
    setSelectedGroupId(null);
    setExpandedGroups(new Set());
    setTooltip(null);
  }, [scope]);

  const months = data?.months.map((m) => m.month) ?? [];
  const hasSpend = (data?.months.some((m) => m.total > 0) ?? false) || (data?.groups.length ?? 0) > 0;
  const showBalance = scope === 'household';

  const groupSeries =
    data?.groups.map((group, i) => ({
      id: group.groupId,
      name: group.name,
      color: group.color || FALLBACK_COLORS[i % FALLBACK_COLORS.length]!,
      values: group.byMonth.map((b) => b.total),
    })) ?? [];

  const detailGroups = useMemo(() => {
    if (!data) return [];
    return data.groups
      .map((group, i) => {
        const total = monthTotal(group.byMonth, selectedMonth);
        const categories = group.categories
          .map((cat) => ({
            ...cat,
            total: monthTotal(cat.byMonth, selectedMonth),
          }))
          .filter((cat) => cat.total > 0)
          .sort((a, b) => b.total - a.total);
        return {
          groupId: group.groupId,
          name: group.name,
          icon: group.icon,
          color: group.color || FALLBACK_COLORS[i % FALLBACK_COLORS.length]!,
          total,
          categories,
        };
      })
      .filter((g) => g.total > 0)
      .sort((a, b) => b.total - a.total);
  }, [data, selectedMonth]);

  const pieSlices = detailGroups.map((g) => ({
    id: g.groupId,
    name: g.name,
    color: g.color,
    value: g.total,
  }));

  const selectedMonthTotal =
    selectedMonth != null
      ? (data?.months.find((m) => m.month === selectedMonth)?.total ?? 0)
      : (data?.months.reduce((sum, m) => sum + m.total, 0) ?? 0);

  const periodTotal = selectedMonthTotal;
  const maxDetail = detailGroups[0]?.total ?? 1;

  const clearGroupSelection = () => {
    setSelectedGroupId(null);
    setTooltip(null);
  };

  const selectGroup = (groupId: string | null) => {
    if (!groupId || selectedGroupId === groupId) {
      clearGroupSelection();
      return;
    }
    const group = detailGroups.find((g) => g.groupId === groupId);
    setSelectedGroupId(groupId);
    if (group) {
      setTooltip({
        title: group.name,
        value: fmtARS.format(group.total),
        meta: `${pctOf(group.total, periodTotal)} del período`,
      });
    }
  };

  const toggleGroup = (groupId: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  const handleMonthSelect = (month: string) => {
    setSelectedMonth((prev) => (prev === month ? null : month));
    setExpandedGroups(new Set());
    clearGroupSelection();
  };

  const handleSegmentSelect = (payload: SegmentSelectPayload) => {
    if (selectedMonth !== payload.month) {
      setSelectedMonth(payload.month);
    }
    setSelectedGroupId(payload.seriesId);
    setTooltip({
      title: `${payload.seriesName} · ${shortMonth(payload.month)}`,
      value: fmtARS.format(payload.value),
      meta: `${pctOf(payload.value, payload.monthTotal)} del mes`,
    });
  };

  const handleLegendClick = (groupId: string) => {
    const wasSelected = selectedGroupId === groupId;
    selectGroup(wasSelected ? null : groupId);
    if (!wasSelected) {
      setExpandedGroups((prev) => {
        const next = new Set(prev);
        next.add(groupId);
        return next;
      });
    } else {
      toggleGroup(groupId);
    }
  };

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Largo plazo</h1>
        </div>
        <Link to="/" className="btn-link">
          ‹ Volver
        </Link>
      </header>

      <ScopeTabs value={scope} onChange={setScope} />

      {isLoading && !data && <p className="empty-state">Cargando…</p>}

      {showBalance && data && data.balance.perUser.length > 1 && (
        <section className="card">
          <h2>Balance acumulado</h2>
          {data.balance.perUser.map((u) => (
            <div key={u.userId} className="list-row">
              <span>
                <strong>{u.name}</strong>
                <span className="balance-detail">
                  {' '}
                  puso {fmtARS.format(u.paid)} · le toca {fmtARS.format(u.share)}
                </span>
              </span>
              <strong className={u.balance >= 0 ? 'balance-pos' : 'balance-neg'}>
                {u.balance >= 0 ? '+' : '−'}
                {fmtARS.format(Math.abs(u.balance))}
              </strong>
            </div>
          ))}
          {data.balance.transfers.length > 0 ? (
            <>
              <div className="settle-transfers">
                {data.balance.transfers.map((t) => (
                  <p key={`${t.fromUserId}-${t.toUserId}`} className="settle-transfer">
                    <strong>{t.fromName}</strong> le debe a <strong>{t.toName}</strong> {fmtARS.format(t.amount)}
                  </p>
                ))}
              </div>
              <button
                type="button"
                className="btn-primary settle-cta"
                onClick={() => setConfirmSettle(true)}
                disabled={settleMutation.isPending}
              >
                Liquidar balance
              </button>
            </>
          ) : (
            <p className="settle-even">Están a mano</p>
          )}
          {data.settlements && data.settlements.length > 0 && (
            <div className="settlement-history">
              <h3>Historial de liquidaciones</h3>
              {data.settlements.slice(0, 10).map((s) => (
                <div key={s.id} className="list-row">
                  <span>
                    <strong>
                      {s.fromName} → {s.toName}
                    </strong>
                    <small>
                      {' '}
                      {fmtDate(s.settledAt)}
                      {s.note ? ` · ${s.note}` : ''}
                    </small>
                  </span>
                  <strong>{fmtARS.format(s.amount)}</strong>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <ConfirmDialog
        open={confirmSettle}
        title="Liquidar balance"
        variant="primary"
        confirmLabel="Confirmar liquidación"
        loadingLabel="Liquidando…"
        loading={settleMutation.isPending}
        onCancel={() => !settleMutation.isPending && setConfirmSettle(false)}
        onConfirm={() => settleMutation.mutate()}
        message={
          <>
            <p>Registrá que ya se pagaron entre ustedes. El balance acumulado vuelve a cero.</p>
            <ul className="settle-confirm-list">
              {(data?.balance.transfers ?? []).map((t) => (
                <li key={`${t.fromUserId}-${t.toUserId}`}>
                  <strong>{t.fromName}</strong> le paga a <strong>{t.toName}</strong> {fmtARS.format(t.amount)}
                </li>
              ))}
            </ul>
            {settleMutation.isError && (
              <p className="error">{(settleMutation.error as Error)?.message ?? 'No se pudo liquidar'}</p>
            )}
          </>
        }
      />

      {data && hasSpend && (
        <section className="card">
          <div className="row-between">
            <h2>Gasto por mes</h2>
            {selectedMonth && (
              <button type="button" className="btn-link" onClick={() => handleMonthSelect(selectedMonth)}>
                Ver todo
              </button>
            )}
          </div>
          <p className="chart-hint">Tocá un mes para filtrar el detalle</p>
          <StackedBars
            months={months}
            series={[{ id: 'total', name: 'Total', color: '#1e305e', values: data.months.map((m) => m.total) }]}
            formatValue={(n) => fmtARS.format(n)}
            formatCompact={fmtCompact}
            showValues
            height={170}
            selectedMonth={selectedMonth}
            onMonthSelect={handleMonthSelect}
          />
          <div className="month-detail-summary">
            <span className="month-detail-label">
              {selectedMonth ? monthLabel(selectedMonth) : 'Últimos 12 meses'}
            </span>
            <strong className="month-detail-amount">{fmtARS.format(selectedMonthTotal)}</strong>
            {selectedMonth && (
              <button
                type="button"
                className="btn-link month-detail-clear"
                onClick={() => handleMonthSelect(selectedMonth)}
              >
                Limpiar
              </button>
            )}
          </div>
        </section>
      )}

      {data && detailGroups.length > 0 && (
        <section className="card">
          <div className="row-between">
            <h2>
              Gasto por grupo
              {selectedMonth ? ` · ${shortMonth(selectedMonth)}` : ''}
            </h2>
            <div className="segmented chart-mode">
              <button
                type="button"
                className={chartMode === 'bars' ? 'active' : ''}
                onClick={() => setChartMode('bars')}
              >
                Barras
              </button>
              <button
                type="button"
                className={chartMode === 'pie' ? 'active' : ''}
                onClick={() => setChartMode('pie')}
              >
                Torta
              </button>
            </div>
          </div>

          {chartMode === 'bars' && !selectedMonth && (
            <StackedBars
              months={months}
              series={groupSeries}
              formatValue={(n) => fmtARS.format(n)}
              selectedMonth={selectedMonth}
              onMonthSelect={handleMonthSelect}
              selectedSeriesId={selectedGroupId}
              onSegmentSelect={handleSegmentSelect}
            />
          )}

          {chartMode === 'bars' && selectedMonth && (
            <div className="month-group-bars">
              {detailGroups.map((group) => (
                <button
                  key={group.groupId}
                  type="button"
                  className={`bar-row${selectedGroupId === group.groupId ? ' selected' : ''}${
                    selectedGroupId && selectedGroupId !== group.groupId ? ' dimmed' : ''
                  }`}
                  onClick={() => selectGroup(group.groupId)}
                >
                  <span className="bar-label">
                    {group.icon} {group.name}
                  </span>
                  <div className="bar-track">
                    <div
                      className="bar-fill"
                      style={{ width: `${(group.total / maxDetail) * 100}%`, background: group.color }}
                    />
                  </div>
                  <span className="bar-pct">{pctOf(group.total, periodTotal)}</span>
                  <span className="bar-amount">{fmtARS.format(group.total)}</span>
                </button>
              ))}
            </div>
          )}

          {chartMode === 'pie' && (
            <div className="pie-chart-wrap">
              <PieChart
                slices={pieSlices}
                formatValue={(n) => fmtARS.format(n)}
                selectedId={selectedGroupId}
                onSelect={selectGroup}
              />
            </div>
          )}

          {tooltip && (
            <ChartTooltip
              title={tooltip.title}
              value={tooltip.value}
              meta={tooltip.meta}
              onDismiss={clearGroupSelection}
            />
          )}

          <div className="chart-legend">
            {detailGroups.map((group) => {
              const open = expandedGroups.has(group.groupId);
              const selected = selectedGroupId === group.groupId;
              return (
                <div key={group.groupId} className="chart-legend-group">
                  <button
                    type="button"
                    className={`chart-legend-item chart-legend-toggle${selected ? ' selected' : ''}`}
                    onClick={() => handleLegendClick(group.groupId)}
                  >
                    <span className="chart-legend-dot" style={{ background: group.color }} />
                    <span className="group-chevron">{open ? '▾' : '▸'}</span>
                    {group.icon} {group.name}
                    <span className="chart-legend-amount">{fmtARS.format(group.total)}</span>
                  </button>
                  {open && (
                    <div className="chart-legend-nested">
                      {group.categories.map((cat) => (
                        <span key={cat.categoryId} className="chart-legend-item nested">
                          {cat.icon} {cat.name}
                          <span className="chart-legend-amount">{fmtARS.format(cat.total)}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {data && !hasSpend && (
        <p className="empty-state">
          Todavía no hay gastos para mostrar. <Link to="/nuevo">Cargá el primero</Link>.
        </p>
      )}
    </div>
  );
}
