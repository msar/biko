import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from './lib/auth';
import { startOutboxSync } from './lib/outbox';
import AdminPage from './pages/AdminPage';
import DashboardPage from './pages/DashboardPage';
import EditExpensePage from './pages/EditExpensePage';
import ExpensesPage from './pages/ExpensesPage';
import LoginPage from './pages/LoginPage';
import LongTermPage from './pages/LongTermPage';
import NewExpensePage from './pages/NewExpensePage';
import PromotionsPage from './pages/PromotionsPage';
import RecurringPaymentsPage from './pages/RecurringPaymentsPage';
import SettingsPage from './pages/SettingsPage';
import ImportStatementPage from './pages/ImportStatementPage';
import DebtsPage from './pages/DebtsPage';
import PartySettlePage from './pages/PartySettlePage';
import AppHeader from './components/AppHeader';
import BrandMark from './components/BrandLogo';
import InstallAppBanner from './components/InstallAppBanner';
import PushEnableBanner from './components/PushEnableBanner';
import { NavigationBar } from './components/ui';
import ExpenseDetailPage from './pages/ExpenseDetailPage';
import TripsPage, { NewTripPage } from './pages/TripsPage';
import TripHubPage from './pages/TripHubPage';
import NewTripExpensePage from './pages/NewTripExpensePage';
import TripExpenseDetailPage from './pages/TripExpenseDetailPage';
import EditTripExpensePage from './pages/EditTripExpensePage';
import TripJoinPage from './pages/TripJoinPage';

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
  return (
    <div className="offline-banner md-banner-warning" role="status">
      Sin conexión — los gastos se guardan y sincronizan después
    </div>
  );
}

function AdminRoute() {
  const { user } = useAuth();
  if (!user?.isSuperUser) return <Navigate to="/" replace />;
  return <AdminPage />;
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

  if (loading) {
    return (
      <div className="page-loading">
        <BrandMark size="md" showWordmark />
        <span>Cargando…</span>
      </div>
    );
  }
  if (!user) return <LoginPage />;

  const hideNav =
    location.pathname === '/nuevo' ||
    location.pathname.startsWith('/gastos/') ||
    location.pathname.startsWith('/importar-resumen') ||
    location.pathname === '/viajes/nuevo' ||
    (location.pathname.startsWith('/viajes/') && location.pathname.includes('/gastos/'));

  return (
    <div className="app">
      <OnlineBanner />
      <InstallAppBanner />
      <PushEnableBanner />
      {!hideNav && <AppHeader />}
      <main className="content">
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/historico" element={<LongTermPage />} />
          <Route path="/nuevo" element={<NewExpensePage />} />
          <Route path="/gastos/:id/edit" element={<EditExpensePage />} />
          <Route path="/gastos/:id" element={<ExpenseDetailPage />} />
          <Route path="/gastos" element={<ExpensesPage />} />
          <Route path="/promos" element={<PromotionsPage />} />
          <Route path="/hoy" element={<Navigate to="/promos" replace />} />
          <Route path="/ajustes" element={<SettingsPage />} />
          <Route path="/importar-resumen" element={<ImportStatementPage />} />
          <Route path="/recurrentes" element={<RecurringPaymentsPage />} />
          <Route path="/deudas" element={<DebtsPage />} />
          <Route path="/juntada" element={<PartySettlePage />} />
          <Route path="/viajes" element={<TripsPage />} />
          <Route path="/viajes/nuevo" element={<NewTripPage />} />
          <Route path="/viajes/invitar/:code" element={<TripJoinPage />} />
          <Route path="/viajes/:id/gastos/nuevo" element={<NewTripExpensePage />} />
          <Route path="/viajes/:id/gastos/:expenseId/editar" element={<EditTripExpensePage />} />
          <Route path="/viajes/:id/gastos/:expenseId" element={<TripExpenseDetailPage />} />
          <Route path="/viajes/:id" element={<TripHubPage />} />
          <Route path="/admin" element={<AdminRoute />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      {!hideNav && <NavigationBar />}
    </div>
  );
}
