import { NavLink, useLocation } from 'react-router-dom';
import Fab from './Fab';
import Icon from './Icon';

interface NavDestination {
  to: string;
  label: string;
  icon: string;
  tab?: string;
}

function tripIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/viajes\/([^/]+)/);
  if (!match) return null;
  const segment = match[1]!;
  if (segment === 'nuevo' || segment === 'invitar') return null;
  return segment;
}

/** Bottom nav while inside Trip Manager — never links to household Biko. */
export default function TripNavigationBar() {
  const location = useLocation();
  const tripId = tripIdFromPath(location.pathname);
  const searchTab = new URLSearchParams(location.search).get('tab') ?? 'resumen';
  const onHub = Boolean(tripId) && /^\/viajes\/[^/]+$/.test(location.pathname);

  const destinations: NavDestination[] = tripId
    ? [
        { to: `/viajes/${tripId}`, label: 'Resumen', icon: 'luggage', tab: 'resumen' },
        { to: `/viajes/${tripId}?tab=gastos`, label: 'Gastos', icon: 'receipt_long', tab: 'gastos' },
        { to: `/viajes/${tripId}?tab=listas`, label: 'Listas', icon: 'checklist', tab: 'listas' },
        { to: `/viajes/${tripId}?tab=personas`, label: 'Personas', icon: 'group', tab: 'personas' },
      ]
    : [{ to: '/viajes', label: 'Viajes', icon: 'luggage' }];

  const left = destinations.slice(0, 2);
  const right = destinations.slice(2);

  return (
    <nav className="md-nav-bar bottom-nav" aria-label="Viajes">
      {left.map((d) => {
        const active = tripId
          ? onHub && (d.tab ?? 'resumen') === searchTab
          : location.pathname === '/viajes';
        return (
          <NavLink
            key={d.to}
            to={d.to}
            end={!d.tab || d.tab === 'resumen'}
            className={() => `md-nav-item${active ? ' md-nav-item-active active' : ''}`}
          >
            <span className="md-nav-indicator nav-icon">
              <Icon name={d.icon} />
            </span>
            {d.label}
          </NavLink>
        );
      })}
      {tripId && (
        <div className="md-nav-fab-slot">
          <Fab
            to={`/viajes/${tripId}/gastos/nuevo`}
            aria-label="Nuevo gasto del viaje"
            icon="add"
            className="nav-add-circle"
          />
        </div>
      )}
      {right.map((d) => {
        const active = onHub && d.tab === searchTab;
        return (
          <NavLink
            key={d.to}
            to={d.to}
            className={() => `md-nav-item${active ? ' md-nav-item-active active' : ''}`}
          >
            <span className="md-nav-indicator nav-icon">
              <Icon name={d.icon} />
            </span>
            {d.label}
          </NavLink>
        );
      })}
      {!tripId && (
        <>
          <span className="md-nav-item" aria-hidden="true" />
          <span className="md-nav-item" aria-hidden="true" />
          <span className="md-nav-item" aria-hidden="true" />
        </>
      )}
    </nav>
  );
}
