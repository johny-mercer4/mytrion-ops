/**
 * Destructive-action confirm, modelled on AuditLog's detail modal (backdrop mousedown guard,
 * Escape to close, focus restored on unmount).
 *
 * Focus lands on the dismiss button rather than the confirm one: every caller here gates work that
 * cannot be undone from the UI, so a stray Enter should not be the thing that revokes an account.
 */
import { useEffect, useRef } from 'react';
import s from './admin.module.css';

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
  // Read through refs so the effect can run once: callers pass inline arrows, and re-running this
  // on every parent render would steal focus back mid-interaction.
  const onCancelRef = useRef(onCancel);
  const busyRef = useRef(busy);
  onCancelRef.current = onCancel;
  busyRef.current = busy;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    /**
     * Lock the page behind the dialog. Not `document.body`: html/body/#root are height:100% here, so
     * the element that actually scrolls a module page is an ancestor container (MytrionShell's
     * `.center`) — locking body would be a silent no-op.
     *
     * Walk up from the panel, but step over every `position: fixed` ancestor FIRST. The nearest one is
     * this dialog's own `.modalBackdrop`; the next (CitiModal, ApplicationModal) is the overlay of the
     * sheet this confirm was raised from. Neither is the page — freezing one would leave the page
     * scrolling behind the dialog, and if a backdrop is ever the scrollport again it takes the sheet's
     * own scroll with it, putting the buttons of a tall dialog out of reach. Landing on the page
     * scroller is also why `scrollHeight > clientHeight`: a container that merely *may* scroll is not it.
     */
    const scroller = (() => {
      let el = panelRef.current?.parentElement ?? null;
      while (el && el !== document.body && getComputedStyle(el).position === 'fixed') {
        el = el.parentElement;
      }
      for (; el && el !== document.documentElement; el = el.parentElement) {
        const overflowY = getComputedStyle(el).overflowY;
        if ((overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight) {
          return el;
        }
      }
      return null;
    })();
    const overflowBefore = scroller?.style.overflow ?? '';
    if (scroller) scroller.style.overflow = 'hidden';
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (busyRef.current) return; // the action is already in flight — no take-backs
      if (e.key === 'Escape') {
        onCancelRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      // Two buttons, so a hand-rolled wrap is enough to keep Tab inside the dialog.
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
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (scroller) scroller.style.overflow = overflowBefore;
      // Confirming a revoke unmounts the button that opened this, so the trigger can be detached
      // by now — focusing it would silently drop focus to <body>.
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  return (
    <div
      className={s.modalBackdrop}
      onMouseDown={(e) => {
        downOnBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (!busy && downOnBackdrop.current && e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        ref={panelRef}
        className={`${s.modal} ${s.modalNarrow}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-body"
      >
        <span className={s.cardTitle} id="confirm-title">
          {title}
        </span>
        <p className={s.sub} id="confirm-body">
          {body}
        </p>
        <div className={s.modalActions} style={{ justifyContent: 'flex-end' }}>
          <button type="button" ref={cancelRef} className={s.ghostBtn} disabled={busy} onClick={onCancel}>
            {cancelLabel}
          </button>
          <button type="button" className={s.dangerBtn} disabled={busy} onClick={onConfirm}>
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
