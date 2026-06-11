import type { ReactNode } from 'react';

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ isOpen, title, message, confirmLabel = 'Delete', onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <div className={`modal-overlay${isOpen ? ' open' : ''}`} onClick={onCancel}>
      <div className="modal confirm-modal" onClick={e => e.stopPropagation()}>
        <h2>{title}</h2>
        <div className="modal-sub">{message}</div>
        <div className="modal-actions">
          <button className="btn-ghost" type="button" onClick={onCancel}>Cancel</button>
          <button className="btn-danger" type="button" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
