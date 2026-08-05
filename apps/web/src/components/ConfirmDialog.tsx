import type { ReactNode } from 'react';
import { Dialog } from './ui';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Shown while `loading` is true. Defaults to a label matching the confirm action. */
  loadingLabel?: string;
  /** `danger` (red, default) for destructive actions; `primary` for constructive ones. */
  variant?: 'danger' | 'primary';
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  loadingLabel,
  variant = 'danger',
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      title={title}
      confirmLabel={confirmLabel}
      cancelLabel={cancelLabel}
      loadingLabel={loadingLabel}
      variant={variant}
      loading={loading}
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      {message}
    </Dialog>
  );
}
