import { useState } from 'react';
import { IosInstallSteps } from './IosInstallSteps';
import {
  dismissInstallBanner,
  isIosDevice,
  isStandaloneDisplay,
  shouldShowIosInstallBanner,
} from '../lib/pwa';
import { useInstallPrompt } from '../lib/useInstallPrompt';

export default function InstallAppBanner() {
  const { canNativeInstall, promptInstall } = useInstallPrompt();
  const [iosVisible, setIosVisible] = useState(() => shouldShowIosInstallBanner());
  const [expanded, setExpanded] = useState(false);

  const standalone = isStandaloneDisplay();
  const ios = isIosDevice();

  if (standalone) return null;

  if (canNativeInstall) {
    return (
      <div className="install-banner" role="region" aria-label="Instalar Biko">
        <div className="install-banner-copy">
          <strong>Instalá Biko como app</strong>
          <span>Acceso rápido y alertas en tu dispositivo.</span>
        </div>
        <button
          type="button"
          className="btn-primary install-banner-action"
          onClick={() => void promptInstall()}
        >
          Instalar
        </button>
      </div>
    );
  }

  if (!ios || !iosVisible) return null;

  return (
    <div className="install-banner" role="region" aria-label="Instalar Biko en iPhone">
      <div className="install-banner-copy">
        <strong>Instalá Biko en tu iPhone</strong>
        <span>Para usarla como app y recibir alertas push.</span>
        {expanded && <IosInstallSteps />}
      </div>
      <div className="install-banner-actions">
        {!expanded ? (
          <button type="button" className="btn-primary install-banner-action" onClick={() => setExpanded(true)}>
            Cómo instalar
          </button>
        ) : null}
        <button
          type="button"
          className="btn-link"
          onClick={() => {
            dismissInstallBanner();
            setIosVisible(false);
          }}
        >
          Ahora no
        </button>
      </div>
    </div>
  );
}
