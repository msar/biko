/** Shared copy for installing Biko as a Home Screen / desktop app. */

export function IosInstallSteps() {
  return (
    <ol className="install-steps">
      <li>
        Tocá el botón <strong>Compartir</strong> en la barra de Safari (el cuadrado con la flecha
        hacia arriba).
      </li>
      <li>
        Elegí <strong>Agregar a pantalla de inicio</strong>.
      </li>
      <li>
        Confirmá con <strong>Agregar</strong>. Después abrí Biko desde el ícono nuevo para activar
        alertas.
      </li>
    </ol>
  );
}
