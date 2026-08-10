/**
 * Publishes how much of the viewport the on-screen keyboard is currently covering, as
 * `--kb-inset` on `<html>`.
 *
 * The problem it solves: on iOS the software keyboard does not resize the layout viewport. `100dvh`
 * stays 100dvh, `position: fixed` stays pinned to a bottom the user can no longer see, and a sheet's
 * action row ends up behind the keys — with no way to scroll it into view, because the sheet is the
 * thing that is fixed. `window.visualViewport` is the only API that reports the covered strip.
 *
 * WHY IT WRITES A CSS VARIABLE INSTEAD OF RETURNING A NUMBER: `resize` fires on every frame of the
 * keyboard animation and again on every pinch-zoom scroll. Routing that through `setState` re-renders
 * the entire subtree ~20 times per keypress-induced viewport change; on a table of 400 rows that is
 * a visibly janky keyboard. A custom property mutates one element and lets the compositor handle the
 * rest, so consumers just write `calc(env(safe-area-inset-bottom) + var(--kb-inset, 0px))`.
 *
 * Mount ONCE, in WorkerLayout. It is a document-level singleton; two copies would fight over the
 * same property on unmount.
 */
import { useEffect } from 'react';

export const KEYBOARD_INSET_PROPERTY = '--kb-inset';

export function useViewportInset(): void {
  useEffect(() => {
    const viewport = window.visualViewport;
    // Absent in jsdom without the stub, and on any browser predating the API. The fallback in
    // `var(--kb-inset, 0px)` is what covers those, so there is nothing to do here.
    if (!viewport) return undefined;

    const root = document.documentElement;

    const sync = (): void => {
      // innerHeight is the LAYOUT viewport; viewport.height is what is actually visible. The
      // difference, minus however far the visual viewport has been scrolled down within it, is the
      // strip the keyboard occupies. Clamped at 0 because a pinch-zoom-out makes it negative.
      const covered = window.innerHeight - viewport.height - viewport.offsetTop;
      root.style.setProperty(KEYBOARD_INSET_PROPERTY, `${Math.max(0, Math.round(covered))}px`);
    };

    sync();
    viewport.addEventListener('resize', sync);
    viewport.addEventListener('scroll', sync);

    return () => {
      viewport.removeEventListener('resize', sync);
      viewport.removeEventListener('scroll', sync);
      root.style.removeProperty(KEYBOARD_INSET_PROPERTY);
    };
  }, []);
}
