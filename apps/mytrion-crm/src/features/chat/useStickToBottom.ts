/**
 * Scroll anchoring for the streaming transcript: autoscroll only while the user is at (or near)
 * the bottom; once they scroll up to read, streaming must not yank them back down. Stickiness
 * lives in a ref (no re-render per token); `atBottom` state updates only on threshold crossings
 * to drive the scroll-to-bottom button.
 */
import { useCallback, useRef, useState, type RefObject } from 'react';

/** px slack under which we still count as "at the bottom" (scroll math, not layout). */
const NEAR_BOTTOM_PX = 48;

export function isNearBottom(scrollTop: number, scrollHeight: number, clientHeight: number): boolean {
  return scrollHeight - scrollTop - clientHeight < NEAR_BOTTOM_PX;
}

export interface StickToBottom {
  containerRef: RefObject<HTMLDivElement>;
  /** Attach to the container's onScroll. */
  onScroll(): void;
  /** Scroll to the end when sticky (each new content tick) — no-op when the user detached. */
  followIfSticky(): void;
  /** Force-stick and jump to the end (sending a message always snaps down). */
  scrollToBottom(): void;
  atBottom: boolean;
}

export function useStickToBottom(): StickToBottom {
  const containerRef = useRef<HTMLDivElement>(null);
  const stickyRef = useRef(true);
  const [atBottom, setAtBottom] = useState(true);

  const onScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const near = isNearBottom(el.scrollTop, el.scrollHeight, el.clientHeight);
    stickyRef.current = near;
    setAtBottom((prev) => (prev === near ? prev : near));
  }, []);

  const scrollToBottom = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    stickyRef.current = true;
    setAtBottom(true);
    // Direct scrollTop (not scrollIntoView) so ancestor scrollports never move.
    el.scrollTop = el.scrollHeight;
  }, []);

  const followIfSticky = useCallback(() => {
    if (!stickyRef.current) return;
    const el = containerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  return { containerRef, onScroll, followIfSticky, scrollToBottom, atBottom };
}
