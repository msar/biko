import type { ReactNode } from 'react';
import Button from './Button';

interface DialogProps {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  loadingLabel?: string;
  variant?: 'danger' | 'primary';
  loading?: boolean;
  /** When true, only the confirm button is shown (e.g. success acknowledgement). */
  singleAction?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function Dialog({
  open,
  title,
  children,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  loadingLabel,
  variant = 'danger',
  loading = false,
  singleAction = false,
  onConfirm,
  onCancel,
}: DialogProps) {
  if (!open) return null;

  const busyLabel =
    loadingLabel ?? (variant === 'danger' ? 'Eliminando…' : 'Registrando…');

  return (
    <div className="md-dialog-overlay confirm-overlay" role="presentation" onClick={onCancel}>
      <div
        className="md-dialog confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="md-dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="md-dialog-title">{title}</h2>
        <div className="md-dialog-body confirm-message">{children}</div>
        <div className="md-dialog-actions confirm-actions">
          {!singleAction && (
            <Button variant="text" disabled={loading} onClick={onCancel}>
              {cancelLabel}
            </Button>
          )}
          <Button
            variant={variant === 'primary' ? 'tonal' : 'danger'}
            disabled={loading}
            onClick={onConfirm}
          >
            {loading ? busyLabel : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
