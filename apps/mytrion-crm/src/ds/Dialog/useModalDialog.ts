import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type AnimationEvent } from 'react';

/**
 * The modal lifecycle, shared by `Dialog` and `Drawer`.
 *
 * WHY A HOOK AND NOT A SECOND COMPONENT: Dialog and Drawer differ only in where the surface is
 * anchored and how it animates in. Everything that is easy to get subtly wrong — open/close
 * sequencing against a controlled `open` prop, Escape, backdrop dismissal, focus return, page
 * scroll locking, waiting for the exit animation before the element leaves the top layer — is
 * identical, so it lives here once. Two copies of this would drift within a quarter.
 *
 * WHY THE NATIVE <dialog> ELEMENT: `showModal()` gives four things that hand-rolled modals get
 * wrong, for free and correctly:
 *   1. a real focus trap (the browser's, not a Tab-key keydown handler that misses shadow roots,
 *      iframes, `contenteditable`, and the browser's own URL bar),
 *   2. inert background content — background controls are not clickable, not focusable, and are
 *      skipped by screen-reader virtual cursors, which a `aria-hidden` sweep never fully achieves,
 *   3. Escape-to-close as a `cancel` event,
 *   4. the top layer, so the surface paints above every stacking context on the page without an
 *      escalating z-index war, and a `::backdrop` pseudo-element to scrim with.
 * The 23 bespoke modals this replaces each re-implemented (1) and (2), and none of them got both.
 */

/** Why the surface is closing. Callers that only need "it closed" can ignore the argument. */
export type DialogCloseReason = 'escape' | 'backdrop' | 'dismiss';

/**
 * `closed` — nothing rendered, element not in the top layer.
 * `open` — shown, entrance animation running or finished.
 * `closing` — exit animation running; the element is STILL in the top layer. This state is the
 *   whole reason the hook exists: a controlled component whose parent flips `open` to false cannot
 *   simply unmount, or the exit animation never gets a chance to paint.
 */
export type ModalPhase = 'closed' | 'open' | 'closing';

/** Structural, not `RefObject<T>`, so a caller's `useRef<HTMLButtonElement>(null)` fits directly. */
export type FocusTargetRef = { readonly current: HTMLElement | null };

export interface UseModalDialogOptions {
  open: boolean;
  /** When false, Escape and backdrop clicks are swallowed and no dismiss affordance is rendered. */
  dismissible: boolean;
  onClose: (reason: DialogCloseReason) => void;
  /**
   * Where focus lands on open. Omit to focus the dialog element itself, which makes a screen reader
   * announce the role and the title before anything else.
   */
  // `| undefined` is explicit because the project runs `exactOptionalPropertyTypes`: without it a
  // caller cannot forward its own optional prop straight through.
  initialFocusRef?: FocusTargetRef | undefined;
}

/**
 * Backstop for the exit animation. If `animationend` never arrives — the panel was given no
 * animation, the tab was backgrounded mid-transition, a browser dropped the event — the surface
 * would otherwise sit in `closing` forever, visible and blocking the page. Comfortably above the
 * 220ms motion ceiling so it never wins a race it should lose.
 */
const EXIT_FALLBACK_MS = 400;

/*
 * Page scroll lock. `showModal()` makes the background INERT but does not stop it SCROLLING: a
 * wheel gesture over the backdrop still scrolls the page underneath, so the user closes the modal
 * and finds themselves somewhere else in a 400-row table.
 *
 * The counter is module scope on purpose. A confirm dialog opened from inside a drawer means two
 * live modals; a per-instance lock would have the inner one restore `overflow` on close while the
 * outer one is still open.
 */
let scrollLockCount = 0;
let scrollLockPrevious = '';

function lockPageScroll(): void {
  if (typeof document === 'undefined') return;
  if (scrollLockCount === 0) {
    scrollLockPrevious = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  scrollLockCount += 1;
}

function unlockPageScroll(): void {
  if (typeof document === 'undefined') return;
  scrollLockCount = Math.max(0, scrollLockCount - 1);
  if (scrollLockCount === 0) document.body.style.overflow = scrollLockPrevious;
}

export interface ModalDialogApi {
  phase: ModalPhase;
  /** Goes on the `<dialog>`. */
  dialogRef: { current: HTMLDialogElement | null };
  /** Goes on the animated surface inside it — the hook filters `animationend` by this element. */
  panelRef: { current: HTMLElement | null };
  /** Ask the parent to close. The parent still owns `open`; this never closes the element itself. */
  requestClose: (reason: DialogCloseReason) => void;
  /** `onMouseDown` for the `<dialog>` — records whether the press STARTED on the backdrop. */
  handleSurfaceMouseDown: (event: MouseEvent<HTMLDialogElement>) => void;
  /** `onClick` for the `<dialog>` — dismisses only when press and release both hit the backdrop. */
  handleSurfaceClick: (event: MouseEvent<HTMLDialogElement>) => void;
  /** `onAnimationEnd` for the `<dialog>` — ends the `closing` phase. */
  handleAnimationEnd: (event: AnimationEvent<HTMLDialogElement>) => void;
}

export function useModalDialog({
  open,
  dismissible,
  onClose,
  initialFocusRef,
}: UseModalDialogOptions): ModalDialogApi {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const lockedRef = useRef(false);
  const backdropPressRef = useRef(false);
  const [phase, setPhase] = useState<ModalPhase>(() => (open ? 'open' : 'closed'));

  // The native `cancel`/`close` listeners below are attached once and read the current props from
  // here. Re-subscribing on every render because `onClose` is an inline arrow at the call site
  // would tear down and rebuild two listeners per keystroke in any dialog containing a field.
  const latest = useRef({ dismissible, onClose });
  useEffect(() => {
    latest.current = { dismissible, onClose };
  });

  const lock = (): void => {
    if (lockedRef.current) return;
    lockedRef.current = true;
    lockPageScroll();
  };
  const unlock = (): void => {
    if (!lockedRef.current) return;
    lockedRef.current = false;
    unlockPageScroll();
  };

  const finishClose = (): void => {
    const el = dialogRef.current;
    if (el?.open) el.close();
    unlock();
    setPhase('closed');
  };

  // ── Open / begin closing, driven by the controlled prop ───────────────────────────────────────
  // Layout, not paint: a useEffect here left one blank frame (phase still `closed`, children
  // unmounted) before showModal ran — the flicker on every Verification row click.
  useLayoutEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open) {
      if (!el.open) {
        // Captured BEFORE showModal(), because showModal() moves focus itself.
        returnFocusRef.current =
          document.activeElement instanceof HTMLElement ? document.activeElement : null;
        el.showModal();
        lock();
      }
      setPhase('open');
    } else if (el.open) {
      setPhase((current) => (current === 'open' ? 'closing' : current));
    }
  }, [open]);

  // ── Escape and the native close event ────────────────────────────────────────────────────────
  // Attached imperatively rather than through React's `onCancel` / `onClose` props: `close` does not
  // bubble, and routing both through one addEventListener pair keeps the two halves of the same
  // contract next to each other.
  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return undefined;

    const handleCancel = (event: Event): void => {
      // ALWAYS preventDefault, dismissible or not. The native default closes the element on the
      // spot, which (a) skips the exit animation entirely and (b) leaves the DOM open=false while
      // the parent's `open` prop is still true — a controlled component that lies about its state.
      // Closing is the parent's decision; all we do is report the request.
      event.preventDefault();
      if (latest.current.dismissible) latest.current.onClose('escape');
    };

    const handleNativeClose = (): void => {
      const target = returnFocusRef.current;
      returnFocusRef.current = null;
      if (!target || !target.isConnected) return;
      // The browser already returns focus to the invoker — but only if that element still exists.
      // The common case where it does not is a row action button in a list the dialog just
      // mutated: the row re-renders, focus falls to <body>, and the keyboard user is dumped at the
      // top of the document. Restore only in that case, so we never fight the native behaviour.
      if (document.activeElement === document.body || document.activeElement === null) {
        target.focus();
      }
    };

    el.addEventListener('cancel', handleCancel);
    el.addEventListener('close', handleNativeClose);
    return () => {
      el.removeEventListener('cancel', handleCancel);
      el.removeEventListener('close', handleNativeClose);
    };
  }, []);

  // ── Initial focus ────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'open') return;
    // Default target is the dialog element (it carries tabindex="-1"), NOT the first focusable
    // descendant that showModal() would otherwise pick. That descendant is usually the header's
    // close button, so a screen reader would open with "Close, button" and never say what the
    // dialog is. Focusing the labelled container announces role + title first.
    const target = initialFocusRef?.current ?? dialogRef.current;
    target?.focus();
    // initialFocusRef is a ref: its identity is stable and its contents must not drive the effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // ── Exit-animation backstop ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'closing') return undefined;
    const timer = window.setTimeout(finishClose, EXIT_FALLBACK_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // ── Unmount while open ───────────────────────────────────────────────────────────────────────
  // A route change that unmounts an open dialog would otherwise leave `body { overflow: hidden }`
  // behind and the page unscrollable with nothing on screen to explain it.
  useEffect(
    () => () => {
      const el = dialogRef.current;
      if (el?.open) el.close();
      unlock();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const requestClose = (reason: DialogCloseReason): void => {
    if (!dismissible) return;
    onClose(reason);
  };

  const handleSurfaceMouseDown = (event: MouseEvent<HTMLDialogElement>): void => {
    backdropPressRef.current = event.target === event.currentTarget;
  };

  const handleSurfaceClick = (event: MouseEvent<HTMLDialogElement>): void => {
    const startedOnBackdrop = backdropPressRef.current;
    backdropPressRef.current = false;
    // Both ends of the click must be the backdrop. Testing only the click target dismisses the
    // dialog when a user selects text in the body and releases the mouse past the panel edge —
    // which loses whatever they had typed, and is the single most reported bug in this pattern.
    if (!startedOnBackdrop || event.target !== event.currentTarget) return;
    requestClose('backdrop');
  };

  const handleAnimationEnd = (event: AnimationEvent<HTMLDialogElement>): void => {
    // animationend bubbles, so a spinner or a shimmer inside the body would otherwise close the
    // dialog on its first loop.
    if (event.target !== panelRef.current) return;
    if (phase !== 'closing') return;
    finishClose();
  };

  return {
    phase,
    dialogRef,
    panelRef,
    requestClose,
    handleSurfaceMouseDown,
    handleSurfaceClick,
    handleAnimationEnd,
  };
}
