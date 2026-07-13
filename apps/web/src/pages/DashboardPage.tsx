import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, fmtARS } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { MonthlyDashboard } from '../lib/types';

function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(y!, m! - 1, 1).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y!, m! - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export default function DashboardPage() {
  const { user } = useAuth();
  const [month, setMonth] = useState(currentMonth());

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard', 'monthly', month],
    queryFn: () => api<MonthlyDashboard>(`/dashboard/monthly?month=${month}`),
  });

  const { data: upcoming } = useQuery({
    queryKey: ['dashboard', 'upcoming'],
    queryFn: () => api<Array<{ month: string; total: number }>>('/dashboard/upcoming'),
  });

  const maxCat = Math.max(1, ...(data?.byCategory.map((c) => c.total) ?? []));

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Hola, {user?.name}</h1>
          <div className="month-nav">
            <button onClick={() => setMonth(shiftMonth(month, -1))}>‹</button>
            <span>{monthLabel(month)}</span>
            <button onClick={() => setMonth(shiftMonth(month, 1))}>›</button>
          </div>
        </div>
      </header>

      <section className="hero-card">
        <span className="hero-label">Gasto del mes</span>
        <span className="hero-amount">{isLoading && !data ? '…' : fmtARS.format(data?.total ?? 0)}</span>
        {data && data.totalSavings > 0 && (
          <span className="hero-savings">Ahorraste {fmtARS.format(data.totalSavings)} con promos 🎉</span>
        )}
      </section>

      {data && data.byCategory.length > 0 && (
        <section className="card">
          <h2>Por categoría</h2>
          {data.byCategory.map((cat) => (
            <div key={cat.categoryId} className="bar-row">
              <span className="bar-label">
                {cat.icon} {cat.name}
              </span>
              <div className="bar-track">
                <div className="bar-fill" style={{ width: `${(cat.total / maxCat) * 100}%`, background: cat.color ?? '#10683f' }} />
              </div>
              <span className="bar-amount">{fmtARS.format(cat.total)}</span>
            </div>
          ))}
        </section>
      )}

      {data && data.byUser.length > 0 && (
        <section className="card">
          <h2>Por persona</h2>
          <div className="pill-row">
            {data.byUser.map((u) => (
              <div key={u.userId} className="pill">
                <strong>{u.name}</strong> {fmtARS.format(u.total)}
              </div>
            ))}
          </div>
        </section>
      )}

      {data?.settleUp && data.settleUp.perUser.length > 1 && (data.settleUp.transfers.length > 0 || data.total > 0) && (
        <section className="card">
          <h2>Balance del mes</h2>
          {data.settleUp.perUser.map((u) => (
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
          {data.settleUp.transfers.length > 0 ? (
            <div className="settle-transfers">
              {data.settleUp.transfers.map((t) => (
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

      {upcoming && upcoming.length > 0 && (
        <section className="card">
          <h2>Cuotas comprometidas</h2>
          {upcoming.slice(0, 6).map((row) => (
            <div key={row.month} className="list-row">
              <span>{monthLabel(row.month)}</span>
              <strong>{fmtARS.format(row.total)}</strong>
            </div>
          ))}
        </section>
      )}

      {data && data.total === 0 && (
        <p className="empty-state">
          Todavía no hay gastos este mes. <Link to="/nuevo">Cargá el primero</Link>.
        </p>
      )}
    </div>
  );
}
