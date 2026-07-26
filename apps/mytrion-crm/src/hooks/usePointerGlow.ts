import { useCallback, useEffect, useRef } from 'react';

/**
 * Pointer-tracked specular highlight — the one Liquid Glass behaviour that CSS can do honestly.
 *
 * Returns a ref to attach to the surface and an `onPointerMove` handler. While the pointer is over
 * the element it writes `--mx` / `--my` (0–100, the pointer's position as a percentage of the box) so
 * a radial-gradient highlight can sit under the cursor, as if a light source were moving across a
 * pane of glass.
 *
 * Two deliberate performance choices, because this fires at pointer rate (60–120Hz):
 *   1. It writes the custom properties STRAIGHT to the node via a ref. Routing pointer position
 *      through React state would re-render the component on every move.
 *   2. Writes are coalesced to one per animation frame, so a 120Hz trackpad still costs one style
 *      recalc per paint.
 *
 * Do NOT attach this to rows in a data table. It is meant for a bounded number of LARGE surfaces
 * (workspace cards, heroes, modals); on a 200-row grid the recalc cost stops being free and the
 * effect is invisible anyway at that size.
 *
 * Honours prefers-reduced-motion by not tracking at all — the surface keeps whatever static
 * highlight its CSS defines.
 */
export function usePointerGlow<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const frame = useRef<number | null>(null);
  const pending = useRef<{ x: number; y: number } | null>(null);
  const reduced = useRef(false);

  useEffect(() => {
    reduced.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent<T>) => {
    if (reduced.current) return;
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    pending.current = {
      x: ((e.clientX - r.left) / r.width) * 100,
      y: ((e.clientY - r.top) / r.height) * 100,
    };
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const p = pending.current;
      const node = ref.current;
      if (!p || !node) return;
      node.style.setProperty('--mx', `${p.x.toFixed(1)}%`);
      node.style.setProperty('--my', `${p.y.toFixed(1)}%`);
    });
  }, []);

  /** Park the highlight back at the card's default corner so leaving doesn't strand it mid-face. */
  const onPointerLeave = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.removeProperty('--mx');
    el.style.removeProperty('--my');
  }, []);

  return { ref, onPointerMove, onPointerLeave };
}
