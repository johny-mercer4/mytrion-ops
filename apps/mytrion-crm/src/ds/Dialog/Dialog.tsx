import { useId, type DialogHTMLAttributes, type ReactNode } from 'react';
import { ModalChrome } from './ModalChrome';
import { useModalDialog, type DialogCloseReason, type FocusTargetRef } from './useModalDialog';
import styles from './Dialog.module.css';

export type { DialogCloseReason, FocusTargetRef };

export type DialogSize = 'sm' | 'md' | 'lg';

/** How the surface behaves below the STRUCTURE line (640px). */
export type DialogMobileMode = 'sheet' | 'fullscreen' | 'centered';

export interface DialogProps
  extends Omit<DialogHTMLAttributes<HTMLDialogElement>, 'title' | 'onClose' | 'open' | 'children'> {
  /** Controlled. The parent owns this; the component never closes itself. */
  open: boolean;
  /**
   * Called for every dismissal route — Escape, backdrop click, the header close button. The parent
   * decides whether to actually set `open` to false, which is what makes "confirm before
   * discarding a half-filled form" possible without a second modal system.
   */
  onClose: (reason: DialogCloseReason) => void;
  /**
   * Required, and required for a reason: it is the dialog's accessible name via `aria-labelledby`.
   * A modal with no name is announced as "dialog" and nothing else.
   */
  title: ReactNode;
  /** One line of context under the title. Longer than a line belongs in the body. */
  subtitle?: ReactNode;
  /**
   * `sm` (420px) — a single decision or a two-field form.
   * `md` (560px) — the default; a short form.
   * `lg` (800px) — a table, a diff, a preview. Above this, use a page.
   */
  size?: DialogSize;
  /**
   * Below the structure line, where a 560px panel is wider than the screen and a centred box with
   * 24px of gutter is a full-screen modal pretending otherwise.
   *
   * `sheet` (default) rises from the bottom edge and caps at 88%, leaving a strip of backdrop that
   *   is both the only remaining dismiss target and the only signal the page is still there. Right
   *   for a record, a short form, a confirmation.
   * `fullscreen` takes the whole viewport with no radius and no backdrop. For a wizard or a form
   *   longer than a screen — those in an 88% sheet are a scroll region inside a scroll region.
   *   A fullscreen dialog has no backdrop to tap, so it MUST render its own way out.
   * `centered` opts out entirely. Rare; a tiny dialog that genuinely reads better centred.
   */
  mobile?: DialogMobileMode;
  /**
   * Default true. Set false ONLY when leaving mid-flow would lose work or corrupt state — it
   * removes Escape, backdrop dismissal AND the close button at once, so a dialog that is not
   * dismissible MUST render its own way out in the footer.
   */
  dismissible?: boolean;
  /** Accessible name for the header close button. */
  closeLabel?: string;
  /** The action row. Pinned to the bottom of the panel; it never scrolls away. */
  footer?: ReactNode;
  /**
   * Where focus lands on open — a first field, or (for a destructive confirm) the SAFE button.
   * Omit to focus the dialog itself, which announces the title first.
   */
  initialFocusRef?: FocusTargetRef;
  children: ReactNode;
}

/**
 * The one modal dialog. Replaces 23 bespoke `*Modal.tsx` files, each with its own overlay div,
 * z-index, Escape handler and (in nineteen of them) no focus trap at all.
 *
 * BUILT ON THE NATIVE `<dialog>` + `showModal()`. That is the load-bearing decision: the browser
 * supplies the focus trap, the inert background, Escape, and the top layer. A hand-written focus
 * trap is a Tab keydown handler over a `querySelectorAll` of focusable selectors, and it is wrong
 * in the same four places every time — `<iframe>`, shadow roots, `contenteditable`, and elements
 * made unfocusable by an ancestor. The native one is not a list of selectors; it is the same code
 * path the browser uses for its own UI.
 *
 * FOCUS — moves to the dialog on open (or to `initialFocusRef`), is trapped inside it for as long
 * as it is open, and RETURNS to the element that opened it on close. The return leg is the browser's
 * by default; the component only intervenes when the trigger was removed by the dialog's own work
 * and focus would otherwise fall to `<body>`.
 *
 * SCROLL — the body scrolls, the header and footer do not. Page scroll behind the backdrop is
 * locked while open: `showModal()` makes the background inert but leaves it scrollable.
 *
 * KEYBOARD
 *   Escape        request close (ignored when `dismissible` is false)
 *   Tab / Shift+Tab  cycles within the dialog, never escaping to the page behind it
 *   Enter / Space    activate the focused control, as normal
 * Backdrop click also requests close, but only when the press AND the release both land on the
 * backdrop — otherwise selecting text in the body and releasing outside would discard the dialog.
 *
 * WHEN NOT TO USE IT
 * - A non-blocking message. That is a toast; a modal that interrupts to say "saved" is a tax.
 * - A confirmation. Use `ConfirmDialog` — same machinery, and it gets the destructive-focus rule
 *   right, which hand-rolled confirms consistently do not.
 * - A long form, a multi-step wizard, or anything the user needs to consult the page to complete.
 *   Modal content cannot be read alongside the record it describes; use a `Drawer` or a route.
 * - Nested modals as a flow. One confirm over one dialog is the ceiling.
 */
export function Dialog({
  open,
  onClose,
  title,
  subtitle,
  size = 'md',
  mobile = 'sheet',
  dismissible = true,
  closeLabel = 'Close',
  footer,
  initialFocusRef,
  children,
  className,
  ...rest
}: DialogProps) {
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
      data-mobile={mobile}
      data-state={phase}
      // Programmatically focusable so the hook can put initial focus HERE rather than on the first
      // control inside. -1 keeps it out of the tab order, where a focusable backdrop would be noise.
      tabIndex={-1}
      aria-labelledby={titleId}
      // Deliberately NO aria-modal. `showModal()` already conveys modality and makes the rest of
      // the document inert; adding the attribute on top has been observed to make some screen
      // readers hide sibling content a second, incompatible way.
      onMouseDown={handleSurfaceMouseDown}
      onClick={handleSurfaceClick}
      onAnimationEnd={handleAnimationEnd}
      {...rest}
    >
      {/* Content is mounted only while the surface is on screen. That keeps a closed dialog's
          fields out of the accessibility tree and the tab order entirely, and means reopening
          starts from a clean form rather than from whatever the user abandoned last time. */}
      {phase === 'closed' ? null : (
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
