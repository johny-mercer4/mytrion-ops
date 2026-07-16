/**
 * Lock the CS content-area scroll while a modal is open so the page behind the
 * backdrop can't scroll (no scroll-bleed when the modal's own scroll reaches an
 * edge, and no wheel pass-through over the dimmed backdrop). Restores on unmount.
 */
import { useEffect } from 'react';

export function useScrollLock(): void {
  useEffect(() => {
    const el = document.querySelector<HTMLElement>('.cs-root .cs-content');
    const prevEl = el?.style.overflow ?? '';
    const prevBody = document.body.style.overflow;
    if (el) el.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    return () => {
      if (el) el.style.overflow = prevEl;
      document.body.style.overflow = prevBody;
    };
  }, []);
}
