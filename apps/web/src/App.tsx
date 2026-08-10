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
import { NavigationBar, TripNavigationBar } from './components/ui';
import ExpenseDetailPage from './pages/ExpenseDetailPage';
import TripsPage, { NewTripPage } from './pages/TripsPage';
import TripHubPage from './pages/TripHubPage';
import NewTripExpensePage from './pages/NewTripExpensePage';
import TripExpenseDetailPage from './pages/TripExpenseDetailPage';
import EditTripExpensePage from './pages/EditTripExpensePage';
import NewTripListItemPage from './pages/NewTripListItemPage';
import TripListItemDetailPage from './pages/TripListItemDetailPage';
import EditTripListItemPage from './pages/EditTripListItemPage';
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

function isTripInvitePath(pathname: string) {
  return pathname.startsWith('/viajes/invitar/');
}

function isTripPath(pathname: string) {
  return pathname === '/viajes' || pathname.startsWith('/viajes/');
}

export default function App() {
  const { user, loading, isGuestSession } = useAuth();
  const location = useLocation();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!user || isGuestSession) return;
    return startOutboxSync(() => {
      void queryClient.invalidateQueries({ queryKey: ['expenses'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    });
  }, [user, isGuestSession, queryClient]);

  if (loading) {
    return (
      <div className="page-loading">
        <BrandMark size="md" showWordmark />
        <span>Cargando…</span>
      </div>
    );
  }

  const onInvite = isTripInvitePath(location.pathname);
  const onTrip = isTripPath(location.pathname);
  const allowWithoutAccount = onInvite || (isGuestSession && onTrip);

  if (!user && !allowWithoutAccount) {
    return <LoginPage />;
  }

  // Guests (and invite preview) stay inside trip routes
  if (isGuestSession && !onTrip) {
    const tripId = user?.tripId;
    return <Navigate to={tripId ? `/viajes/${tripId}` : '/viajes/invitar/'} replace />;
  }

  if (!user && onInvite) {
    return (
      <div className="app">
        <main className="content">
          <Routes>
            <Route path="/viajes/invitar/:code" element={<TripJoinPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    );
  }

  const hideNav =
    location.pathname === '/nuevo' ||
    location.pathname.startsWith('/gastos/') ||
    location.pathname.startsWith('/importar-resumen') ||
    location.pathname === '/viajes/nuevo' ||
    (location.pathname.startsWith('/viajes/') &&
      (location.pathname.includes('/gastos/') || location.pathname.includes('/listas/'))) ||
    onInvite;

  const useTripNav = onTrip && !hideNav;

  return (
    <div className="app">
      <OnlineBanner />
      {!isGuestSession && <InstallAppBanner />}
      {!isGuestSession && <PushEnableBanner />}
      {!hideNav && !useTripNav && !isGuestSession && <AppHeader />}
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
          <Route path="/viajes/:id/listas/nuevo" element={<NewTripListItemPage />} />
          <Route path="/viajes/:id/listas/:itemId/editar" element={<EditTripListItemPage />} />
          <Route path="/viajes/:id/listas/:itemId" element={<TripListItemDetailPage />} />
          <Route path="/viajes/:id" element={<TripHubPage />} />
          <Route path="/admin" element={<AdminRoute />} />
          <Route
            path="*"
            element={<Navigate to={isGuestSession && user?.tripId ? `/viajes/${user.tripId}` : '/'} replace />}
          />
        </Routes>
      </main>
      {useTripNav ? <TripNavigationBar /> : !hideNav && !isGuestSession ? <NavigationBar /> : null}
    </div>
  );
}
