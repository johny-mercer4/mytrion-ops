/**
 * Destructive-action confirm for Customer Service — replaces window.confirm(), which ignores the
 * module's design language entirely (native chrome, no theming, and it blocks the main thread).
 *
 * Mirrors admin/ConfirmDialog's accessibility contract (role="alertdialog", Escape to dismiss, Tab
 * trapped between the two buttons, focus restored on unmount) but is built from the CS `cs-modal-*`
 * primitives so it sits in the Paper White sheet language.
 *
 * Focus lands on Cancel, not Confirm: every caller gates something the UI cannot undo, so a stray
 * Enter must not be the thing that deletes a record.
 */
import { useEffect, useRef } from 'react';

const WARN_PATH =
  'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z';

export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  cancelLabel = 'Cancel',
  busy,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel?: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const downOnBackdrop = useRef(false);
  // Read through refs so the effect runs once: callers pass inline arrows, and re-running this on
  // every parent render would steal focus back mid-interaction.
  const onCancelRef = useRef(onCancel);
  const busyRef = useRef(busy);
  onCancelRef.current = onCancel;
  busyRef.current = busy;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (busyRef.current) return; // the action is already in flight — no take-backs
      if (e.key === 'Escape') {
        // Stop the host modal's own Escape handler from closing it out from under us.
        e.stopPropagation();
        onCancelRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const focusables = panelRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled)');
      const first = focusables?.[0];
      const last = focusables?.[focusables.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    // Capture phase, so this runs BEFORE the host modal's document-level keydown listener.
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      // Confirming may unmount the button that opened this, so the trigger can be detached by now —
      // focusing it would silently drop focus to <body>.
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  return (
    <div
      className="cs-modal-backdrop cs-confirm-backdrop"
      onMouseDown={(e) => {
        downOnBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (!busy && downOnBackdrop.current && e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        ref={panelRef}
        className="cs-modal-box cs-confirm-box"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="cs-confirm-title"
        aria-describedby="cs-confirm-body"
      >
        <div className="cs-confirm-body">
          <div className="cs-confirm-icon" aria-hidden="true">
            <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={WARN_PATH} />
            </svg>
          </div>
          <div className="cs-confirm-copy">
            <h3 className="cs-confirm-title" id="cs-confirm-title">
              {title}
            </h3>
            <p className="cs-confirm-text" id="cs-confirm-body">
              {body}
            </p>
          </div>
        </div>
        <div className="cs-confirm-actions">
          <button type="button" ref={cancelRef} className="cs-btn cs-btn-ghost" disabled={busy} onClick={onCancel}>
            {cancelLabel}
          </button>
          <button type="button" className="cs-btn cs-confirm-danger" disabled={busy} onClick={onConfirm}>
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
