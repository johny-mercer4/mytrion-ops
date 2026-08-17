import { useId, type DialogHTMLAttributes, type ReactNode } from 'react';
import { ModalChrome } from '../Dialog/ModalChrome';
import {
  useModalDialog,
  type DialogCloseReason,
  type FocusTargetRef,
} from '../Dialog/useModalDialog';
import styles from './Drawer.module.css';

export type DrawerSize = 'sm' | 'md' | 'lg';

export interface DrawerProps
  extends Omit<DialogHTMLAttributes<HTMLDialogElement>, 'title' | 'onClose' | 'open' | 'children'> {
  /** Controlled. The parent owns this; the component never closes itself. */
  open: boolean;
  onClose: (reason: DialogCloseReason) => void;
  /** Required — it is the drawer's accessible name via `aria-labelledby`. */
  title: ReactNode;
  subtitle?: ReactNode;
  /**
   * `sm` (360px) — filters, a property list.
   * `md` (440px) — the default; a record's detail or an edit form.
   * `lg` (600px) — a timeline, a thread, anything with its own inner columns.
   */
  size?: DrawerSize;
  /** Default true. False removes Escape, backdrop dismissal AND the close button together. */
  dismissible?: boolean;
  closeLabel?: string;
  /** Pinned action row. Never scrolls away. */
  footer?: ReactNode;
  /** Where focus lands on open. Omit to focus the drawer itself, announcing the title first. */
  initialFocusRef?: FocusTargetRef;
  children: ReactNode;
}

/**
 * A modal panel anchored to the edge of the viewport — record detail, filters, an edit form beside
 * the list it belongs to.
 *
 * SAME MACHINERY AS `Dialog`, deliberately: the native `<dialog>` element with `showModal()`, so
 * the browser supplies the focus trap, the inert background, Escape and the top layer, and the
 * `useModalDialog` hook supplies the controlled open/close sequencing, backdrop dismissal, page
 * scroll lock and focus return. A drawer is a dialog with a different anchor; treating it as a
 * separate species is how the two end up with different Escape behaviour.
 *
 * ANCHOR — `inline-end` on a normal viewport, so the drawer opens beside the content that spawned
 * it rather than on top of it. Under 560px it becomes a `block-end` sheet, because a 440px panel
 * on a 375px screen is a full-screen modal wearing a drawer's animation, and a sheet rising from
 * the bottom is both reachable by thumb and honest about what it is.
 *
 * STILL MODAL. The background is inert, exactly as a dialog's is. If the user needs to interact
 * with the page while the panel is open, this is the wrong component — see below.
 *
 * KEYBOARD
 *   Escape           request close (ignored when `dismissible` is false)
 *   Tab / Shift+Tab  cycles within the drawer, never reaching the page behind it
 *   Enter / Space    activate the focused control
 * Backdrop click requests close when press and release both land on the backdrop.
 *
 * WHEN NOT TO USE IT
 * - A panel the user works ALONGSIDE the page — comparing a record against the table behind it,
 *   copying a value across. That is a docked side panel in the layout, not a modal; this one makes
 *   the page inert and there is no prop that changes that.
 * - Primary navigation. A rail is a rail.
 * - A short confirmation or a two-field form. Those are `Dialog` / `ConfirmDialog`; a full-height
 *   panel holding one sentence reads as a loading state that never finished.
 * - Stacking drawers to represent depth. The second one hides the first, which is the opposite of
 *   what the pattern was chosen to communicate.
 */
export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  size = 'md',
  dismissible = true,
  closeLabel = 'Close',
  footer,
  initialFocusRef,
  children,
  className,
  ...rest
}: DrawerProps) {
  const titleId = useId();
  const {
    phase,
    dialogRef,
    panelRef,
    requestClose,
    handleSurfaceMouseDown,
    handleSurfaceClick,
    handleAnimationEnd,
  } = useModalDialog({ open, dismissible, onClose, initialFocusRef });

  return (
    <dialog
      ref={dialogRef}
      className={[styles.dialog, className].filter(Boolean).join(' ')}
      data-size={size}
      data-state={phase}
      // Focusable only by script, so initial focus can land on the labelled container itself.
      tabIndex={-1}
      aria-labelledby={titleId}
      onMouseDown={handleSurfaceMouseDown}
      onClick={handleSurfaceClick}
      onAnimationEnd={handleAnimationEnd}
      {...rest}
    >
      {phase === 'closed' && !open ? null : (
        <section className={styles.panel} ref={panelRef}>
          <ModalChrome
            titleId={titleId}
            title={title}
            subtitle={subtitle}
            dismissible={dismissible}
            closeLabel={closeLabel}
            onDismiss={() => requestClose('dismiss')}
            footer={footer}
          >
            {children}
          </ModalChrome>
        </section>
      )}
    </dialog>
  );
}
