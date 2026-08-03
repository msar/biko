import { Link } from 'react-router-dom';

const ACTIONS = [
  { to: '/recurrentes', label: 'Recurrentes' },
  { to: '/deudas', label: 'Deudas' },
  { to: '/juntada', label: 'Liquidar juntada' },
  { to: '/historico', label: 'Largo plazo', trailing: true },
] as const;

export default function QuickActions() {
  return (
    <nav className="quick-actions" aria-label="Accesos rápidos">
      {ACTIONS.map((a) => (
        <Link key={a.to} to={a.to} className="action-chip">
          {a.label}
          {'trailing' in a && a.trailing ? <span className="action-chip-arrow">›</span> : null}
        </Link>
      ))}
    </nav>
  );
}
