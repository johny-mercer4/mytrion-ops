import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { TimeOffWorkspace } from './TimeOffWorkspace';
import styles from './UserTimeOffModal.module.css';

export function UserTimeOffModal({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const prior = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    dialog.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      prior?.focus();
    };
  }, [onClose]);

  return (
    <div className={styles.backdrop} role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div ref={dialog} className={styles.dialog} role="dialog" aria-modal="true" aria-label="My time off" tabIndex={-1}>
        <button type="button" className={styles.close} onClick={onClose} aria-label="Close Time Off">
          <X size={19} />
        </button>
        <TimeOffWorkspace />
      </div>
    </div>
  );
}
