import { useEffect, useRef, useState, type RefObject } from 'react';

/**
 * useWindowedRows — dependency-free fixed-height row virtualization for a scroll
 * container. Only the visible slice (+ overscan) is rendered; the caller pads the
 * list with two spacer rows (`padTop`/`padBottom` px) so the scrollbar geometry
 * stays exact. Solves the Data Center / Transactions tab-switch microfreeze: those
 * tables rendered thousands of <tr> nodes, and Shell toggles each panel with
 * display:none↔contents — hiding/showing that many nodes forces a full style+layout
 * recalc. Windowing keeps the live node count to ~one viewport regardless of total.
 *
 * The scroll handler computes the range directly (no requestAnimationFrame) and only
 * calls setState when the row window actually shifts — i.e. at most once per
 * `rowHeight` px of scroll, not per pixel — so it stays cheap without rAF coalescing.
 *
 * Fixed row height is required for O(1) range math — enforce it in CSS on the row
 * (e.g. `.dc-deal-row { height: 52px }` + `white-space: nowrap` so a long cell can't
 * wrap and drift the offsets).
 */
export interface WindowRange {
  /** first row index to render (inclusive) */
  start: number;
  /** last row index to render (exclusive) */
  end: number;
  /** spacer height above the window, px */
  padTop: number;
  /** spacer height below the window, px */
  padBottom: number;
}

export function useWindowedRows(
  scrollRef: RefObject<HTMLElement | null>,
  rowCount: number,
  rowHeight: number,
  overscan = 8,
): WindowRange {
  const initialEnd = Math.min(rowCount, 40);
  const [range, setRange] = useState<WindowRange>({
    start: 0,
    end: initialEnd,
    padTop: 0,
    padBottom: Math.max(0, (rowCount - initialEnd) * rowHeight),
  });
  // Mirror of `range` so the scroll handler can compare without re-subscribing.
  const rangeRef = useRef(range);
  rangeRef.current = range;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const compute = () => {
      // Hidden panels (display:none) report clientHeight 0 — fall back so the window
      // is pre-populated and the switch-back paint has rows ready.
      const viewport = el.clientHeight || 600;
      const visible = Math.ceil(viewport / rowHeight);
      const maxStart = Math.max(0, rowCount - visible); // never scroll past the last screenful
      let start = Math.max(0, Math.floor(el.scrollTop / rowHeight) - overscan);
      start = Math.min(start, maxStart);
      const end = Math.min(rowCount, start + visible + overscan * 2);

      const cur = rangeRef.current;
      if (start === cur.start && end === cur.end) return; // no boundary crossed → skip render
      const next: WindowRange = {
        start,
        end,
        padTop: start * rowHeight,
        padBottom: Math.max(0, (rowCount - end) * rowHeight),
      };
      rangeRef.current = next;
      setRange(next);
    };

    compute(); // initial + whenever rowCount/height change (deps below)
    el.addEventListener('scroll', compute, { passive: true });
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', compute);
      ro.disconnect();
    };
  }, [scrollRef, rowCount, rowHeight, overscan]);

  return range;
}
