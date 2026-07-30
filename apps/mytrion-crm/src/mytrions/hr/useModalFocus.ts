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

export function useModalFocus<T extends HTMLElement>(): React.RefObject<T> {
  const ref = useRef<T>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    // Remember where focus was, so closing returns the user to the control they opened this from.
    const previous = document.activeElement as HTMLElement | null;

    const focusable = (): HTMLElement[] =>
      Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );

    /**
     * First real field, not the close button — the close button is the LAST thing someone opening an
     * editor wants their cursor in, and it is one Shift+Tab away.
     */
    const first = focusable().find((el) => !el.hasAttribute('data-focus-skip')) ?? node;
    first.focus();

    const onKeyDown = (ev: KeyboardEvent): void => {
      if (ev.key !== 'Tab') return;
      const items = focusable();
      if (items.length === 0) return;
      const firstItem = items[0]!;
      const lastItem = items[items.length - 1]!;
      const active = document.activeElement;
      if (!ev.shiftKey && active === lastItem) {
        ev.preventDefault();
        firstItem.focus();
      } else if (ev.shiftKey && active === firstItem) {
        ev.preventDefault();
        lastItem.focus();
      } else if (active && !node.contains(active)) {
        // Focus escaped (a click on the backdrop, a browser quirk) — pull it back in.
        ev.preventDefault();
        firstItem.focus();
      }
    };

    node.addEventListener('keydown', onKeyDown);
    return () => {
      node.removeEventListener('keydown', onKeyDown);
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
    select((index + delta + count) % count);
  };
}

/** `tabIndex` for one option in a roving-tabindex group. */
export function rovingTabIndex(isSelected: boolean, isFirst: boolean, anySelected: boolean): 0 | -1 {
  if (anySelected) return isSelected ? 0 : -1;
  return isFirst ? 0 : -1;
}
