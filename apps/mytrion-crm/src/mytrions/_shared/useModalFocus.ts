/**
 * Focus management for HR's dialogs.
 *
 * A container with `role="dialog" aria-modal="true"` is a PROMISE to assistive tech: focus is inside,
 * Tab cannot leave, and it comes back where it started on close. Declaring the attribute without keeping
 * the promise is worse than not declaring it — a screen-reader user is told they are in a modal while Tab
 * walks them into the page behind it, with no way to know they have left.
 *
 * Deliberately small: initial focus, a Tab cycle, and focus restoration. Escape stays with the caller,
 * which is the only place that knows whether a save is in flight and must not be interrupted.
 */
import { useEffect, useRef } from 'react';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Every dialog currently mounted, innermost last.
 *
 * Two jobs. The Tab handler is on `document` (see below), so without this every open dialog would
 * handle the same keystroke and they would fight over focus — only the topmost may act. And the
 * background scroll lock has to survive nesting: the first dialog locks, the last one to close
 * restores, so a nested dialog closing does not hand scrolling back to a page still behind a modal.
 */
const openDialogs: HTMLElement[] = [];

/**
 * Per-element lock bookkeeping for the background scroll freeze, keyed by the element actually locked.
 *
 * Refcounted because nested dialogs (and a second dialog opened from a first) resolve to the SAME
 * scroller: the outermost lock must survive the inner one closing, and the original value has to come
 * back exactly once. A plain save/restore pair leaked `overflow: hidden` for the rest of the session.
 */
const scrollLocks = new Map<HTMLElement, { depth: number; previous: string }>();

/**
 * The page's scroll container — deliberately NOT <body>.
 *
 * `html`, `body` and `#root` are all `height: 100%` (styles/global.css) and the shell's `.center`
 * carries `overflow-y: auto`, so body never scrolls in this app and setting `body.style.overflow`
 * freezes nothing. Walk up for the first ancestor that genuinely scrolls instead.
 */
function pageScroller(node: HTMLElement): HTMLElement | null {
  let start = node.parentElement;
  // Step over the dialog's own overlay: every backdrop here is `position: fixed`, and locking one
  // would clip a sheet taller than the viewport rather than freeze the page behind it.
  while (start && start !== document.body && window.getComputedStyle(start).position === 'fixed') {
    start = start.parentElement;
  }
  for (let el = start; el && el !== document.documentElement; el = el.parentElement) {
    const overflowY = window.getComputedStyle(el).overflowY;
    if ((overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight) {
      return el;
    }
  }
  return null;
}

export function useModalFocus<T extends HTMLElement>(): React.RefObject<T> {
  const ref = useRef<T>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    // Remember where focus was, so closing returns the user to the control they opened this from.
    const previous = document.activeElement as HTMLElement | null;

    /**
     * The container must be able to hold focus itself: both the fallback below and the pull-back
     * call `.focus()`, which is a silent no-op on a plain <div>. -1 keeps it out of the Tab order
     * (FOCUSABLE excludes [tabindex="-1"]) while making it programmatically focusable — unlike 0,
     * which would make the container the first tab stop.
     */
    if (!node.hasAttribute('tabindex')) node.setAttribute('tabindex', '-1');

    openDialogs.push(node);

    const scroller = pageScroller(node);
    if (scroller) {
      const held = scrollLocks.get(scroller);
      if (held) held.depth += 1;
      else {
        scrollLocks.set(scroller, { depth: 1, previous: scroller.style.overflow });
        scroller.style.overflow = 'hidden';
      }
    }

    const focusable = (): HTMLElement[] =>
      Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );

    /**
     * First real field, not the close button — the close button is the LAST thing someone opening an
     * editor wants their cursor in, and it is one Shift+Tab away.
     *
     * A read-only dialog can be nothing BUT skipped controls (the department view for a non-admin is
     * a <dl> and one Close button), so fall through to the first focusable of any kind before the
     * container: landing on Close is a real control, landing on the <div> is a dead end.
     */
    const initial = focusable();
    const first = initial.find((el) => !el.hasAttribute('data-focus-skip')) ?? initial[0] ?? node;
    first.focus();

    const onKeyDown = (ev: KeyboardEvent): void => {
      if (ev.key !== 'Tab') return;
      // Nested dialogs: only the innermost owns the Tab key.
      if (openDialogs[openDialogs.length - 1] !== node) return;
      const items = focusable();
      const active = document.activeElement;
      // Nothing focusable left (every control disabled mid-save) — hold focus on the container
      // rather than letting Tab walk into the page behind an aria-modal dialog.
      if (items.length === 0) {
        ev.preventDefault();
        node.focus();
        return;
      }
      const firstItem = items[0]!;
      const lastItem = items[items.length - 1]!;
      if (!active || !node.contains(active)) {
        // Focus is outside: clicking non-focusable modal content drops it to <body>, and a control
        // that was focused can be unmounted or disabled. Pull it back to the edge Tab was heading for.
        ev.preventDefault();
        (ev.shiftKey ? lastItem : firstItem).focus();
      } else if (!ev.shiftKey && active === lastItem) {
        ev.preventDefault();
        firstItem.focus();
      } else if (ev.shiftKey && active === firstItem) {
        ev.preventDefault();
        lastItem.focus();
      }
    };

    /**
     * On `document`, capturing — NOT on the dialog node.
     *
     * Keydown is dispatched at `document.activeElement`, so a listener on the dialog only runs while
     * focus is already inside it. That is precisely the case the trap must not depend on: the moment
     * focus sits on <body> (a click on the modal's heading, a focused control unmounting) the node
     * listener is never in the propagation path and Tab walks natively into the page behind the
     * backdrop, while the container still claims aria-modal="true".
     */
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      const at = openDialogs.indexOf(node);
      if (at !== -1) openDialogs.splice(at, 1);
      if (scroller) {
        const held = scrollLocks.get(scroller);
        if (held && held.depth <= 1) {
          scroller.style.overflow = held.previous;
          scrollLocks.delete(scroller);
        } else if (held) held.depth -= 1;
      }
      // Only restore if focus is still ours to move; the user may have clicked elsewhere deliberately.
      if (previous && document.body.contains(previous)) previous.focus();
    };
  }, []);

  return ref;
}

/**
 * Arrow-key navigation for a `role="radiogroup"` of buttons (the icon and colour pickers).
 *
 * A radiogroup is ONE tab stop with arrows moving between options — the icon picker had 26 of them, so
 * reaching the field after it meant 26 presses of Tab. `roving` gives the selected option (or the first)
 * `tabIndex 0` and every other `-1`, which is the pattern the ARIA spec describes.
 */
export function radioGroupKeyDown(count: number, index: number, select: (next: number) => void) {
  return (ev: React.KeyboardEvent): void => {
    const delta =
      ev.key === 'ArrowRight' || ev.key === 'ArrowDown'
        ? 1
        : ev.key === 'ArrowLeft' || ev.key === 'ArrowUp'
          ? -1
          : 0;
    if (delta === 0) return;
    ev.preventDefault();
    // Wraps, so the group has no dead ends.
    const next = (index + delta + count) % count;
    select(next);
    /**
     * Focus has to follow the selection. `rovingTabIndex` moves the group's single tab STOP to the
     * newly selected option, so leaving DOM focus on the old one desyncs the two: the next Arrow
     * press is still handled by the previously focused option and computes its step from the stale
     * `index`, and a screen reader keeps announcing the option the user has moved off.
     */
    const group = ev.currentTarget.closest('[role="radiogroup"]');
    group?.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus();
  };
}

/** `tabIndex` for one option in a roving-tabindex group. */
export function rovingTabIndex(isSelected: boolean, isFirst: boolean, anySelected: boolean): 0 | -1 {
  if (anySelected) return isSelected ? 0 : -1;
  return isFirst ? 0 : -1;
}
