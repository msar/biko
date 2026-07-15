import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import StackedBars from '../components/charts/StackedBars';
import { api, fmtARS } from '../lib/api';
import type { DashboardScope, LongTermDashboard } from '../lib/types';

const FALLBACK_COLORS = ['#1e305e', '#00a8b5', '#e8b93c', '#b3423f', '#10683f', '#7b5ea7', '#d97742', '#4a90d9'];

export default function LongTermPage() {
  const [scope, setScope] = useState<DashboardScope>('household');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard', 'long-term', 12, scope],
    queryFn: () => api<LongTermDashboard>(`/dashboard/long-term?months=12&scope=${scope}`),
  });

  const groupSeries =
    data?.groups.map((group, i) => ({
      id: group.groupId,
      name: group.name,
      color: group.color || FALLBACK_COLORS[i % FALLBACK_COLORS.length]!,
      values: group.byMonth.map((b) => b.total),
    })) ?? [];

  const months = data?.months.map((m) => m.month) ?? [];
  const hasSpend = (data?.months.some((m) => m.total > 0) ?? false) || groupSeries.length > 0;
  const showBalance = scope === 'household';

  const toggleGroup = (groupId: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
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
          <h2>Gasto por mes</h2>
          <StackedBars
            months={months}
            series={[{ id: 'total', name: 'Total', color: '#1e305e', values: data.months.map((m) => m.total) }]}
            formatValue={(n) => fmtARS.format(n)}
          />
        </section>
      )}

      {data && groupSeries.length > 0 && (
        <section className="card">
          <h2>Gasto por grupo</h2>
          <StackedBars months={months} series={groupSeries} formatValue={(n) => fmtARS.format(n)} />
          <div className="chart-legend">
            {data.groups.map((group, i) => {
              const open = expandedGroups.has(group.groupId);
              return (
                <div key={group.groupId} className="chart-legend-group">
                  <button type="button" className="chart-legend-item chart-legend-toggle" onClick={() => toggleGroup(group.groupId)}>
                    <span
                      className="chart-legend-dot"
                      style={{ background: group.color || FALLBACK_COLORS[i % FALLBACK_COLORS.length]! }}
                    />
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
