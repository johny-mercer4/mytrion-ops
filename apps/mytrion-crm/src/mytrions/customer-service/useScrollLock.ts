/**
 * Lock the CS content-area scroll while a modal is open so the page behind the
 * backdrop can't scroll (no scroll-bleed when the modal's own scroll reaches an
 * edge, and no wheel pass-through over the dimmed backdrop). Restores on unmount.
 *
 * Also flags `<body data-cs-modal-open>` for the duration. App-wide fixed overlays live OUTSIDE
 * `.cs-root`, and `.cs-root { isolation: isolate }` traps the modal's z-index in its own stacking
 * context — so no z-index a modal can set will put it above such an overlay. The attribute lets
 * those overlays step aside instead (see the RingCentral sign-in card in ringcentralHost.css).
 */
import { useEffect } from 'react';

const MODAL_OPEN_ATTR = 'data-cs-modal-open';
/** Depth, not a boolean: a modal that opens another (Citifuel client → delete confirm) must not
 *  clear the flag when only the inner one closes. */
let openDepth = 0;

export function useScrollLock(): void {
  useEffect(() => {
    const el = document.querySelector<HTMLElement>('.cs-root .cs-content');
    const prevEl = el?.style.overflow ?? '';
    const prevBody = document.body.style.overflow;
    if (el) el.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    openDepth += 1;
    document.body.setAttribute(MODAL_OPEN_ATTR, '');
    return () => {
      if (el) el.style.overflow = prevEl;
      document.body.style.overflow = prevBody;
      openDepth = Math.max(0, openDepth - 1);
      if (openDepth === 0) document.body.removeAttribute(MODAL_OPEN_ATTR);
    };
  }, []);
}
