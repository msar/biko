import { Link } from 'react-router-dom';
import BrandMark from './BrandLogo';

export default function AppHeader() {
  return (
    <header className="app-header">
      <BrandMark size="sm" showWordmark />
      <Link to="/ajustes" className="icon-btn" aria-label="Ajustes">
        ⚙️
      </Link>
    </header>
  );
}
