import { useEffect, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from './lib/auth';
import { startOutboxSync } from './lib/outbox';
import DashboardPage from './pages/DashboardPage';
import EditExpensePage from './pages/EditExpensePage';
import ExpensesPage from './pages/ExpensesPage';
import LoginPage from './pages/LoginPage';
import NewExpensePage from './pages/NewExpensePage';
import PromotionsPage from './pages/PromotionsPage';
import SettingsPage from './pages/SettingsPage';

function OnlineBanner() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  if (online) return null;
  return <div className="offline-banner">Sin conexión — los gastos se guardan y sincronizan después</div>;
}

export default function App() {
  const { user, loading } = useAuth();
  const location = useLocation();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!user) return;
    return startOutboxSync(() => {
      void queryClient.invalidateQueries({ queryKey: ['expenses'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    });
  }, [user, queryClient]);

  if (loading) return <div className="page-loading">Cargando…</div>;
  if (!user) return <LoginPage />;

  const hideNav = location.pathname === '/nuevo' || location.pathname.startsWith('/gastos/');

  return (
    <div className="app">
      <OnlineBanner />
      <main className="content">
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/nuevo" element={<NewExpensePage />} />
          <Route path="/gastos/:id/edit" element={<EditExpensePage />} />
          <Route path="/gastos" element={<ExpensesPage />} />
          <Route path="/promos" element={<PromotionsPage />} />
          <Route path="/hoy" element={<Navigate to="/promos" replace />} />
          <Route path="/ajustes" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      {!hideNav && (
        <nav className="bottom-nav">
          <NavLink to="/" end>
            <span className="nav-icon">📊</span>Resumen
          </NavLink>
          <NavLink to="/gastos">
            <span className="nav-icon">🧾</span>Gastos
          </NavLink>
          <NavLink to="/nuevo" className="nav-add">
            <span className="nav-add-circle">+</span>
          </NavLink>
          <NavLink to="/promos">
            <span className="nav-icon">📅</span>Promos
          </NavLink>
        </nav>
      )}
    </div>
  );
}
