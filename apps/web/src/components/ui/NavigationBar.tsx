import { NavLink } from 'react-router-dom';
import Fab from './Fab';
import Icon from './Icon';

interface NavDestination {
  to: string;
  label: string;
  icon: string;
  end?: boolean;
}

const DESTINATIONS: NavDestination[] = [
  { to: '/', label: 'Resumen', icon: 'monitoring', end: true },
  { to: '/gastos', label: 'Gastos', icon: 'receipt_long' },
  { to: '/promos', label: 'Promos', icon: 'local_offer' },
  { to: '/ajustes', label: 'Más', icon: 'more_horiz' },
];

export default function NavigationBar() {
  return (
    <nav className="md-nav-bar bottom-nav" aria-label="Principal">
      {DESTINATIONS.slice(0, 2).map((d) => (
        <NavLink
          key={d.to}
          to={d.to}
          end={d.end}
          className={({ isActive }) => `md-nav-item${isActive ? ' md-nav-item-active active' : ''}`}
        >
          <span className="md-nav-indicator nav-icon">
            <Icon name={d.icon} />
          </span>
          {d.label}
        </NavLink>
      ))}
      <div className="md-nav-fab-slot">
        <Fab to="/nuevo" aria-label="Nuevo gasto" icon="add" className="nav-add-circle" />
      </div>
      {DESTINATIONS.slice(2).map((d) => (
        <NavLink
          key={d.to}
          to={d.to}
          className={({ isActive }) => `md-nav-item${isActive ? ' md-nav-item-active active' : ''}`}
        >
          <span className="md-nav-indicator nav-icon">
            <Icon name={d.icon} />
          </span>
          {d.label}
        </NavLink>
      ))}
    </nav>
  );
}
