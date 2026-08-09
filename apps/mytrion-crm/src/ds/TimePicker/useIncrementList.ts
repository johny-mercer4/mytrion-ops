import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MutableRefObject,
  type RefObject,
} from 'react';
import type { TimeIncrement } from './TimeList';

/*
 * Open/close, highlight and placement for TimePicker's increment listbox — the SECONDARY affordance.
 *
 * Its own file for the same two reasons as useTimeSegments: the 600-line cap next door, and a real
 * seam. Nothing here knows what a time is; it drives a list of opaque values.
 */

/** Popup geometry in px. `POPUP_MAX_H` mirrors `--tp-popup-h`'s ceiling in the stylesheet. */
const POPUP_MAX_H = 288;
const POPUP_MIN_H = 152;
const VIEWPORT_GAP = 8;

export interface IncrementListOptions {
  rows: readonly TimeIncrement[];
  /** The field's live value. Read on open (to highlight it) and on Escape (to know what to undo). */
  currentRef: MutableRefObject<string | null>;
  /** The element the popup is measured and positioned against. */
  anchorRef: RefObject<HTMLElement | null>;
  onCommit: (value: string | null) => void;
}

export interface IncrementListApi {
  open: boolean;
  activeIndex: number;
  setActiveIndex: (index: number) => void;
  placement: 'bottom' | 'top';
  height: number;
  listRef: MutableRefObject<HTMLDivElement | null>;
  triggerRef: MutableRefObject<HTMLButtonElement | null>;
  openList: () => void;
  /** `restore: true` puts back the value held when the list opened. Escape's undo. */
  closeList: (restore: boolean) => void;
  onListKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
}

export function useIncrementList({
  rows,
  currentRef,
  anchorRef,
  onCommit,
}: IncrementListOptions): IncrementListApi {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [placement, setPlacement] = useState<'bottom' | 'top'>('bottom');
  const [height, setHeight] = useState(POPUP_MAX_H);

  const listRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  /** The value at the moment the list opened — what Escape restores. */
  const snapshot = useRef<string | null>(null);

  const openList = useCallback((): void => {
    if (rows.length === 0) return;
    snapshot.current = currentRef.current;
    // Open ON the current value, so Enter repeats what is already there instead of silently
    // replacing it with row one.
    const at = rows.findIndex((row) => row.value === currentRef.current);
    setActiveIndex(at >= 0 ? at : 0);
    setOpen(true);
  }, [rows, currentRef]);

  const closeList = useCallback(
    (restore: boolean): void => {
      setOpen(false);
      setActiveIndex(-1);
      if (restore && snapshot.current !== currentRef.current) onCommit(snapshot.current);
      // Focus goes back to the button that opened the list — never to whatever the browser picks
      // when the element under the cursor is removed, which is the top of the document.
      triggerRef.current?.focus();
    },
    [currentRef, onCommit],
  );

  // Held in a ref so the document listener below subscribes once per open rather than on every
  // render — an outside press COMMITS, so it must not drag `onCommit`'s identity into its deps.
  const dismiss = useRef<() => void>(() => undefined);
  useEffect(() => {
    dismiss.current = () => {
      setOpen(false);
      setActiveIndex(-1);
    };
  });

  // `pointerdown` and not `click`, because it has to fire before the focus change repaints —
  // otherwise the panel is stranded over whatever the user was reaching for.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event: PointerEvent): void => {
      if (!anchorRef.current?.contains(event.target as Node)) dismiss.current();
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open, anchorRef]);

  // Focus the list itself on open. The rows are never tab stops: 288 of them would be 288 stops.
  useEffect(() => {
    if (open) listRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  /* Anchor below; flip above only when below is genuinely short AND above is roomier — a popup that
     flips on every few pixels of scroll is worse than one that is occasionally cramped. `true` on
     the scroll listener catches scrolling ANCESTORS, not just the page. */
  useLayoutEffect(() => {
    if (!open) return undefined;
    const measure = (): void => {
      const rect = anchorRef.current?.getBoundingClientRect();
      if (!rect) return;
      const below = window.innerHeight - rect.bottom - VIEWPORT_GAP;
      const above = rect.top - VIEWPORT_GAP;
      const up = below < POPUP_MIN_H && above > below;
      setPlacement(up ? 'top' : 'bottom');
      setHeight(Math.max(POPUP_MIN_H, Math.min(POPUP_MAX_H, up ? above : below)));
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [open, anchorRef]);

  const onListKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>): void => {
      switch (event.key) {
        // NO WRAP. On a 96-row grid, jumping from the last row back to the first loses the user's
        // place; Home/End is the deliberate way to cross the list.
        case 'ArrowDown':
          event.preventDefault();
          setActiveIndex((i) => Math.min(rows.length - 1, i + 1));
          return;
        case 'ArrowUp':
          event.preventDefault();
          setActiveIndex((i) => Math.max(0, i - 1));
          return;
        case 'Home':
          event.preventDefault();
          setActiveIndex(0);
          return;
        case 'End':
          event.preventDefault();
          setActiveIndex(rows.length - 1);
          return;
        case 'Enter':
        case ' ': {
          event.preventDefault();
          const row = activeIndex >= 0 ? rows[activeIndex] : undefined;
          if (row) onCommit(row.value);
          closeList(false);
          return;
        }
        case 'Escape':
          event.preventDefault();
          // Handled here; the dialog this field may sit inside must not also act on the same press.
          event.stopPropagation();
          closeList(true);
          return;
        case 'Tab':
          // No preventDefault — Tab must move focus. It COMMITS, unlike Escape.
          setOpen(false);
          setActiveIndex(-1);
          return;
        default:
          return;
      }
    },
    [activeIndex, rows, closeList, onCommit],
  );

  return {
    open,
    activeIndex,
    setActiveIndex,
    placement,
    height,
    listRef,
    triggerRef,
    openList,
    closeList,
    onListKeyDown,
  };
}
