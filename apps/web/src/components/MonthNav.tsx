import { Link } from 'react-router-dom';
import { IconButton } from './ui';

interface MonthNavProps {
  label: string;
  onPrev: () => void;
  onNext: () => void;
}

export default function MonthNav({ label, onPrev, onNext }: MonthNavProps) {
  return (
    <div className="month-nav-row">
      <div className="month-nav" aria-label="Mes">
        <IconButton icon="chevron_left" label="Mes anterior" onClick={onPrev} />
        <span>{label}</span>
        <IconButton icon="chevron_right" label="Mes siguiente" onClick={onNext} />
      </div>
      <Link to="/historico" className="month-nav-long-term">
        Largo plazo
        <span className="material-symbols-outlined ms-icon-sm" aria-hidden>
          chevron_right
        </span>
      </Link>
    </div>
  );
}
