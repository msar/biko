import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getPushPermission, pushSupported } from '../lib/push';
import { isStandaloneDisplay } from '../lib/pwa';

const DISMISS_KEY = 'biko:push-enable-banner-dismissed';

/** Soft nudge when the PWA is installed but push permission was never asked. */
export default function PushEnableBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!isStandaloneDisplay() || !pushSupported()) return;
    try {
      if (localStorage.getItem(DISMISS_KEY) === '1') return;
    } catch {
      return;
    }
    void getPushPermission().then((p) => {
      if (p === 'default') setVisible(true);
    });
  }, []);

  if (!visible) return null;

  return (
    <div className="install-banner push-enable-banner" role="region" aria-label="Activar alertas">
      <div className="install-banner-copy">
        <strong>Activá las alertas</strong>
        <span>Enterate cuando haya un gasto nuevo o un pago recurrente.</span>
      </div>
      <div className="install-banner-actions">
        <Link
          to="/ajustes"
          className="btn-primary install-banner-action"
          onClick={() => setVisible(false)}
        >
          Ir a Más
        </Link>
        <button
          type="button"
          className="btn-link"
          onClick={() => {
            try {
              localStorage.setItem(DISMISS_KEY, '1');
            } catch {
              // ignore
            }
            setVisible(false);
          }}
        >
          Ahora no
        </button>
      </div>
    </div>
  );
}
