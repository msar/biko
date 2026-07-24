import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import PieChart from '../components/charts/PieChart';
import StackedBars, { shortMonth } from '../components/charts/StackedBars';
import { api, fmtARS } from '../lib/api';
import type { DashboardScope, LongTermDashboard } from '../lib/types';

const FALLBACK_COLORS = ['#1e305e', '#00a8b5', '#e8b93c', '#b3423f', '#10683f', '#7b5ea7', '#d97742', '#4a90d9'];

type ChartMode = 'bars' | 'pie';

function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(y!, m! - 1, 1).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
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

export default function LongTermPage() {
  const [scope, setScope] = useState<DashboardScope>('household');
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [chartMode, setChartMode] = useState<ChartMode>('bars');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard', 'long-term', 12, scope],
    queryFn: () => api<LongTermDashboard>(`/dashboard/long-term?months=12&scope=${scope}`),
  });

  useEffect(() => {
    setSelectedMonth(null);
    setExpandedGroups(new Set());
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

      <div className="segmented dashboard-scope">
        <button type="button" className={scope === 'household' ? 'active' : ''} onClick={() => setScope('household')}>
          Hogar
        </button>
        <button type="button" className={scope === 'personal' ? 'active' : ''} onClick={() => setScope('personal')}>
          Personal
        </button>
        <button type="button" className={scope === 'all' ? 'active' : ''} onClick={() => setScope('all')}>
          Todo
        </button>
      </div>

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
            <div className="settle-transfers">
              {data.balance.transfers.map((t) => (
                <p key={`${t.fromUserId}-${t.toUserId}`} className="settle-transfer">
                  <strong>{t.fromName}</strong> le debe a <strong>{t.toName}</strong> {fmtARS.format(t.amount)}
                </p>
              ))}
            </div>
          ) : (
            <p className="settle-even">Están a mano 🤝</p>
          )}
        </section>
      )}

      {data && hasSpend && (
        <section className="card">
          <div className="row-between">
            <h2>Gasto por mes</h2>
            {selectedMonth && (
              <button type="button" className="btn-link" onClick={() => setSelectedMonth(null)}>
                Ver todo
              </button>
            )}
          </div>
          <p className="chart-hint">Tocá un mes para ver el detalle abajo</p>
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
            />
          )}

          {chartMode === 'bars' && selectedMonth && (
            <div className="month-group-bars">
              {detailGroups.map((group) => {
                const max = detailGroups[0]?.total ?? 1;
                return (
                  <div key={group.groupId} className="bar-row">
                    <span className="bar-label">
                      {group.icon} {group.name}
                    </span>
                    <div className="bar-track">
                      <div
                        className="bar-fill"
                        style={{ width: `${(group.total / max) * 100}%`, background: group.color }}
                      />
                    </div>
                    <span className="bar-amount">{fmtARS.format(group.total)}</span>
                  </div>
                );
              })}
            </div>
          )}

          {chartMode === 'pie' && (
            <div className="pie-chart-wrap">
              <PieChart slices={pieSlices} formatValue={(n) => fmtARS.format(n)} />
            </div>
          )}

          <div className="chart-legend">
            {detailGroups.map((group) => {
              const open = expandedGroups.has(group.groupId);
              return (
                <div key={group.groupId} className="chart-legend-group">
                  <button
                    type="button"
                    className="chart-legend-item chart-legend-toggle"
                    onClick={() => toggleGroup(group.groupId)}
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
