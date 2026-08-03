import { IosInstallSteps } from './IosInstallSteps';
import { isIosDevice, isStandaloneDisplay } from '../lib/pwa';
import { useInstallPrompt } from '../lib/useInstallPrompt';

type Props = {
  /** When true, render as an h3 subsection (inside Ajustes) instead of a card. */
  embedded?: boolean;
};

/** Settings section: install Biko as an app (iOS instructions or Chromium prompt). */
export default function InstallAppSection({ embedded = false }: Props) {
  const { canNativeInstall, promptInstall } = useInstallPrompt();
  const ios = isIosDevice();
  const standalone = isStandaloneDisplay();

  const title = standalone ? 'App instalada' : 'Instalar como app';
  const body = standalone ? (
    <p className="hint">
      Estás usando Biko como aplicación. Podés activar las alertas push en la sección de notificaciones.
    </p>
  ) : canNativeInstall ? (
    <>
      <p className="hint">Agregá Biko a tu dispositivo para abrirla más rápido y recibir alertas.</p>
      <button type="button" className="btn-primary" onClick={() => void promptInstall()}>
        Instalar Biko
      </button>
    </>
  ) : ios ? (
    <>
      <p className="hint">
        En iPhone, instalá Biko desde Safari para usarla a pantalla completa y poder activar notificaciones
        push (iOS 16.4+).
      </p>
      <IosInstallSteps />
    </>
  ) : (
    <p className="hint">
      En Chrome o Edge, usá el menú del navegador → <strong>Instalar aplicación</strong> (o
      <strong> Agregar a la pantalla de inicio</strong>).
    </p>
  );

  if (embedded) {
    return (
      <div className="settings-subsection">
        <h3>{title}</h3>
        {body}
      </div>
    );
  }

  return (
    <section className="card">
      <h2>{title}</h2>
      {body}
    </section>
  );
}
