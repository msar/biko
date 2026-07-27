import { IosInstallSteps } from './IosInstallSteps';
import { isIosDevice, isStandaloneDisplay } from '../lib/pwa';
import { useInstallPrompt } from '../lib/useInstallPrompt';

/** Settings section: install Biko as an app (iOS instructions or Chromium prompt). */
export default function InstallAppSection() {
  const { canNativeInstall, promptInstall } = useInstallPrompt();
  const ios = isIosDevice();
  const standalone = isStandaloneDisplay();

  if (standalone) {
    return (
      <section className="card">
        <h2>App instalada</h2>
        <p className="hint">
          Estás usando Biko como aplicación. Podés activar las alertas push en la sección de
          notificaciones.
        </p>
      </section>
    );
  }

  return (
    <section className="card">
      <h2>Instalar como app</h2>
      {canNativeInstall ? (
        <>
          <p className="hint">Agregá Biko a tu dispositivo para abrirla más rápido y recibir alertas.</p>
          <button type="button" className="btn-primary" onClick={() => void promptInstall()}>
            Instalar Biko
          </button>
        </>
      ) : ios ? (
        <>
          <p className="hint">
            En iPhone, instalá Biko desde Safari para usarla a pantalla completa y poder activar
            notificaciones push (iOS 16.4+).
          </p>
          <IosInstallSteps />
        </>
      ) : (
        <p className="hint">
          En Chrome o Edge, usá el menú del navegador → <strong>Instalar aplicación</strong> (o
          <strong> Agregar a la pantalla de inicio</strong>).
        </p>
      )}
    </section>
  );
}
