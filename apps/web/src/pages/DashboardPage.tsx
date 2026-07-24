import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, fmtARS, fmtDate } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { DashboardScope, MonthlyDashboard, RecurringOccurrence } from '../lib/types';

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

const SCOPE_LABELS: Record<DashboardScope, string> = {
  household: 'Gasto del hogar',
  personal: 'Gasto personal',
  all: 'Gasto total',
};

const EMPTY_COPY: Record<DashboardScope, string> = {
  household: 'Todavía no hay gastos del hogar este mes.',
  personal: 'Todavía no hay gastos personales este mes.',
  all: 'Todavía no hay gastos este mes.',
};

export default function DashboardPage() {
  const { user } = useAuth();
  const [month, setMonth] = useState(currentMonth());
  const [scope, setScope] = useState<DashboardScope>('household');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard', 'monthly', month, scope],
    queryFn: () => api<MonthlyDashboard>(`/dashboard/monthly?month=${month}&scope=${scope}`),
  });

  const { data: upcoming } = useQuery({
    queryKey: ['dashboard', 'upcoming', scope],
    queryFn: () => api<Array<{ month: string; total: number }>>(`/dashboard/upcoming?scope=${scope}`),
  });

  const { data: pendingOcc } = useQuery({
    queryKey: ['recurring-occurrences', 'PENDING'],
    queryFn: () => api<RecurringOccurrence[]>('/recurring-payments/occurrences?status=PENDING&limit=8'),
  });

  const maxGroup = Math.max(1, ...(data?.byGroup.map((g) => g.total) ?? []));
  const showSettle = scope === 'household';

  useEffect(() => {
    setExpandedGroups(new Set());
    setExpandedCategories(new Set());
  }, [month, scope]);

  const toggleGroup = (groupId: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  const toggleCategory = (categoryId: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(categoryId)) next.delete(categoryId);
      else next.add(categoryId);
      return next;
    });
  };

  const expensesForCategory = (categoryId: string) =>
    (data?.installments ?? []).filter((inst) => inst.categoryId === categoryId);

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
        <div className="header-links">
          <Link to="/recurrentes" className="btn-link">
            Recurrentes
          </Link>
          <Link to="/historico" className="btn-link">
            Largo plazo ›
          </Link>
        </div>
      </header>

      {pendingOcc && pendingOcc.length > 0 && (
        <section className="card">
          <div className="row-between">
            <h2>Vencimientos</h2>
            <Link to="/recurrentes" className="btn-link">
              Ver todos
            </Link>
          </div>
          {pendingOcc.slice(0, 5).map((occ) => (
            <div key={occ.id} className="list-row">
              <span>
                <strong>{occ.recurringPayment.name}</strong>
                <small>
                  {' '}
                  {fmtDate(occ.dueDate)}
                  {occ.recurringPayment.amountType === 'VARIABLE' ? ' · completar monto' : ''}
                </small>
              </span>
              {occ.amount && <strong>{fmtARS.format(Number(occ.amount))}</strong>}
            </div>
          ))}
        </section>
      )}

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

      <section className="hero-card">
        <span className="hero-label">{SCOPE_LABELS[scope]}</span>
        <span className="hero-amount">{isLoading && !data ? '…' : fmtARS.format(data?.total ?? 0)}</span>
        {data && data.totalSavings > 0 && (
          <span className="hero-savings">Ahorraste {fmtARS.format(data.totalSavings)} con promos 🎉</span>
        )}
      </section>

      {data && data.byGroup.length > 0 && (
        <section className="card">
          <h2>Por grupo</h2>
          {data.byGroup.map((group) => {
            const open = expandedGroups.has(group.groupId);
            return (
              <div key={group.groupId} className="group-block">
                <button type="button" className="group-row" onClick={() => toggleGroup(group.groupId)}>
                  <span className="bar-label">
                    <span className="group-chevron">{open ? '▾' : '▸'}</span>
                    {group.icon} {group.name}
                  </span>
                  <div className="bar-track">
                    <div
                      className="bar-fill"
                      style={{ width: `${(group.total / maxGroup) * 100}%`, background: group.color }}
                    />
                  </div>
                  <span className="bar-amount">{fmtARS.format(group.total)}</span>
                </button>
                {open && (
                  <div className="group-categories">
                    {group.categories.map((cat) => {
                      const catOpen = expandedCategories.has(cat.categoryId);
                      const expenses = expensesForCategory(cat.categoryId);
                      return (
                        <div key={cat.categoryId} className="category-block">
                          <button
                            type="button"
                            className="group-row bar-row-nested"
                            onClick={() => toggleCategory(cat.categoryId)}
                          >
                            <span className="bar-label">
                              <span className="group-chevron">{catOpen ? '▾' : '▸'}</span>
                              {cat.icon} {cat.name}
                            </span>
                            <div className="bar-track">
                              <div
                                className="bar-fill"
                                style={{
                                  width: `${(cat.total / maxGroup) * 100}%`,
                                  background: cat.color ?? group.color,
                                }}
                              />
                            </div>
                            <span className="bar-amount">{fmtARS.format(cat.total)}</span>
                          </button>
                          {catOpen && (
                            <div className="category-expenses">
                              {expenses.length === 0 ? (
                                <p className="category-expenses-empty">Sin detalle disponible</p>
                              ) : (
                                expenses.map((inst) => (
                                  <Link
                                    key={inst.id}
                                    to={`/gastos/${inst.purchaseId}/edit`}
                                    className="category-expense-row"
                                  >
                                    <span>
                                      <strong>{inst.store}</strong>
                                      <small>
                                        {' '}
                                        {fmtDate(inst.dueDate)}
                                        {inst.totalInstallments > 1
                                          ? ` · cuota ${inst.number}/${inst.totalInstallments}`
                                          : ''}
                                        {` · ${inst.userName}`}
                                      </small>
                                    </span>
                                    <strong>{fmtARS.format(inst.amount)}</strong>
                                  </Link>
                                ))
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </section>
      )}

      {showSettle && data && data.byUser.length > 0 && (
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

      {showSettle &&
        data?.settleUp &&
        data.settleUp.perUser.length > 1 &&
        (data.settleUp.transfers.length > 0 || data.total > 0) && (
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
          {EMPTY_COPY[scope]} <Link to="/nuevo">Cargá el primero</Link>.
        </p>
      )}
    </div>
  );
}
