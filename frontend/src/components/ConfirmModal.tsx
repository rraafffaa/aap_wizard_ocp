import React, { useEffect, useRef } from 'react';
import { ExclamationTriangleIcon, TrashIcon } from '@patternfly/react-icons';

interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  variant: 'danger' | 'warning';
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({
  isOpen,
  title,
  message,
  confirmLabel,
  cancelLabel = 'Cancel',
  variant,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isOpen) cancelRef.current?.focus();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  const Icon = variant === 'danger' ? TrashIcon : ExclamationTriangleIcon;
  const btnClass = variant === 'danger' ? 'aap-btn aap-btn--danger' : 'aap-btn aap-btn--primary';

  return (
    <div className="aap-overlay" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
      <div className="aap-modal">
        <div className="aap-modal__icon">
          <Icon />
        </div>
        <h2 id="confirm-title" className="aap-modal__title">{title}</h2>
        <p className="aap-modal__body">{message}</p>
        <div className="aap-modal__actions">
          <button
            ref={cancelRef}
            className="aap-btn aap-btn--secondary"
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button className={btnClass} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
