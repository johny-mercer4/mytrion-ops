/**
 * Overlay anchoring — the machinery Tooltip and DropdownMenu genuinely share.
 *
 * NOT A COMPONENT. This folder holds no `.tsx` and no stylesheet; it exists because a tooltip and a
 * menu differ entirely in semantics and not at all in geometry, and shipping the same 120 lines of
 * flip-and-clamp twice is how two overlays drift into two different ideas of "8px below the button".
 *
 * THREE DECISIONS WORTH THE COMMENT:
 *
 * 1. `position: fixed` in a body portal, not absolute-in-place. An overlay rendered inside its
 *    anchor's subtree is clipped by the first ancestor with `overflow: hidden` — which in this app
 *    is every table wrapper, every scroll pane, and the rail. Fixed + portal is the only version
 *    that cannot be cropped. It is also why the coordinates below are raw viewport coordinates with
 *    no `scrollX` term: `fixed` is already viewport-relative, and adding the scroll offset is the
 *    single most common bug in hand-rolled positioners.
 *
 * 2. The portal goes on `document.body`, which is also what makes `fixed` trustworthy. A `fixed`
 *    element inside a transformed ancestor positions against THAT ancestor, not the viewport —
 *    the containing-block trap CONVENTIONS §3 warns about from the other direction. Body has no
 *    transform, so there is nothing to be captured by.
 *
 * 3. The gap between anchor and overlay is read OFF the element as `--overlay-gap`, rather than
 *    hardcoded here. Geometry has to happen in JS, but the VALUE stays a token in the stylesheet
 *    where a designer can find it; this module just asks the layer how far away it wants to sit.
 */
import {
  useCallback,
  useLayoutEffect,
  useState,
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type MutableRefObject,
  type ReactElement,
  type Ref,
  type RefObject,
} from 'react';

/** Which side of the anchor the overlay sits on. */
export type OverlaySide = 'top' | 'bottom' | 'left' | 'right';
/** How it lines up along the other axis. `center` is the unsuffixed form. */
export type OverlayAlign = 'start' | 'center' | 'end';
/**
 * `bottom` centres under the anchor; `bottom-start` lines its leading edge up with the anchor's.
 * A menu almost always wants `-start` (the label column should align with the trigger); a tooltip
 * almost always wants the centred form.
 */
export type OverlayPlacement = OverlaySide | `${OverlaySide}-start` | `${OverlaySide}-end`;

/** Breathing room kept between the overlay and the viewport edge. Mirrors --space-2. */
const VIEWPORT_PAD = 8;
/** Used only if the layer has not declared `--overlay-gap`. Mirrors --space-2. */
const FALLBACK_GAP = 8;

const OPPOSITE: Record<OverlaySide, OverlaySide> = {
  top: 'bottom',
  bottom: 'top',
  left: 'right',
  right: 'left',
};

interface Position {
  left: number;
  top: number;
  side: OverlaySide;
  align: OverlayAlign;
}

export interface AnchoredLayerOptions {
  /** The element the overlay points at. */
  anchorRef: RefObject<HTMLElement>;
  /** The overlay element itself — measured, never mutated. */
  layerRef: RefObject<HTMLElement>;
  open: boolean;
  placement: OverlayPlacement;
}

export interface AnchoredLayer {
  /** Spread onto the layer. Carries `position: fixed` and the resolved coordinates. */
  style: CSSProperties;
  /** The side actually used AFTER collision flipping — feed it to `data-side` so CSS can react. */
  side: OverlaySide;
  align: OverlayAlign;
}

function splitPlacement(placement: OverlayPlacement): [OverlaySide, OverlayAlign] {
  const [side, align] = placement.split('-') as [OverlaySide, 'start' | 'end' | undefined];
  return [side, align ?? 'center'];
}

function clamp(value: number, min: number, max: number): number {
  // max can land below min on a viewport narrower than the overlay; min wins, so the overlay
  // overflows the FAR edge and keeps its leading edge readable rather than centring the overflow.
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function readGap(layer: HTMLElement): number {
  const raw = getComputedStyle(layer).getPropertyValue('--overlay-gap');
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : FALLBACK_GAP;
}

/**
 * Positions `layerRef` against `anchorRef` while `open`, flipping to the opposite side when the
 * preferred one does not fit and clamping the cross axis inside the viewport.
 *
 * Recomputes on scroll (capture phase, so it catches scrolling containers and not just the window),
 * on resize, and when the layer's own box changes — a menu whose content grows must not stay glued
 * to a stale rectangle.
 */
export function useAnchoredLayer({
  anchorRef,
  layerRef,
  open,
  placement,
}: AnchoredLayerOptions): AnchoredLayer {
  const [position, setPosition] = useState<Position | null>(null);

  const compute = useCallback(() => {
    const anchor = anchorRef.current;
    const layer = layerRef.current;
    if (!anchor || !layer) return;

    const rect = anchor.getBoundingClientRect();
    // offsetWidth/Height, not getBoundingClientRect: the rect reports the POST-transform box, and
    // during the entrance animation the layer is mid-translate. Offsets are layout values and are
    // stable from the first frame, so the overlay does not creep as it animates in.
    const w = layer.offsetWidth;
    const h = layer.offsetHeight;
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const gap = readGap(layer);

    let [side, align] = splitPlacement(placement);

    // ── Flip. Only when the preferred side genuinely cannot hold the overlay AND the opposite side
    //    has more room; "more room" rather than "enough room" so a cramped viewport still picks the
    //    less bad option instead of thrashing.
    const room: Record<OverlaySide, number> = {
      top: rect.top - gap,
      bottom: vh - rect.bottom - gap,
      left: rect.left - gap,
      right: vw - rect.right - gap,
    };
    const needed = side === 'top' || side === 'bottom' ? h : w;
    if (room[side] < needed + VIEWPORT_PAD && room[OPPOSITE[side]] > room[side]) {
      side = OPPOSITE[side];
    }

    let left: number;
    let top: number;

    if (side === 'top' || side === 'bottom') {
      top = side === 'top' ? rect.top - gap - h : rect.bottom + gap;
      left =
        align === 'start'
          ? rect.left
          : align === 'end'
            ? rect.right - w
            : rect.left + (rect.width - w) / 2;
    } else {
      left = side === 'left' ? rect.left - gap - w : rect.right + gap;
      top =
        align === 'start'
          ? rect.top
          : align === 'end'
            ? rect.bottom - h
            : rect.top + (rect.height - h) / 2;
    }

    left = clamp(left, VIEWPORT_PAD, vw - w - VIEWPORT_PAD);
    top = clamp(top, VIEWPORT_PAD, vh - h - VIEWPORT_PAD);

    // Whole pixels. A fractional `left` on a text-bearing layer makes the whole overlay resample
    // and the type goes soft — visible at 11-13px, which is the entire type ladder this app uses.
    const next: Position = { left: Math.round(left), top: Math.round(top), side, align };

    setPosition((prev) =>
      prev &&
      prev.left === next.left &&
      prev.top === next.top &&
      prev.side === next.side &&
      prev.align === next.align
        ? prev // Same box — return the previous object so React bails out of the re-render.
        : next,
    );
  }, [anchorRef, layerRef, placement]);

  // useLayoutEffect, not useEffect: measurement and the state it produces must both land BEFORE
  // paint, or the overlay is visibly drawn at 0,0 for one frame and then snaps into place.
  useLayoutEffect(() => {
    if (!open) return;
    compute();

    let frame = 0;
    const schedule = (): void => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(compute);
    };

    // `capture: true` is the load-bearing part: scroll does not bubble, so a bubble-phase listener
    // on window never hears a scrolling DIV — and every long surface in this app scrolls a div.
    window.addEventListener('scroll', schedule, { capture: true, passive: true });
    window.addEventListener('resize', schedule);

    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    if (observer && layerRef.current) observer.observe(layerRef.current);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule, { capture: true });
      window.removeEventListener('resize', schedule);
      observer?.disconnect();
    };
  }, [open, compute, layerRef]);

  const [preferredSide, preferredAlign] = splitPlacement(placement);

  return {
    style: position
      ? { position: 'fixed', left: position.left, top: position.top }
      : // Pre-measurement. `opacity: 0` rather than `visibility: hidden`, and that is not
        // cosmetic: a `visibility: hidden` element cannot be focused, and an open menu focuses its
        // first row from a layout effect that runs in this very commit — hiding it that way would
        // silently swallow the landing focus. At zero opacity the layer is still a real, focusable,
        // measurable box. It never paints either way: the layout effect above replaces this style
        // before the browser gets a frame.
        { position: 'fixed', left: 0, top: 0, opacity: 0 },
    side: position?.side ?? preferredSide,
    align: position?.align ?? preferredAlign,
  };
}

/**
 * Writes one value into whichever of React's two ref shapes was handed over.
 * Needed because both overlays clone a caller-supplied trigger: the caller's own ref has to keep
 * working, and ours has to be attached alongside it.
 */
export function setRef<T>(ref: Ref<T> | undefined, value: T | null): void {
  if (typeof ref === 'function') ref(value);
  else if (ref) (ref as MutableRefObject<T | null>).current = value;
}

/** Fans one DOM node out to several refs. Stable identity is the caller's job (useCallback). */
export function mergeRefs<T>(...refs: Array<Ref<T> | undefined>): (value: T | null) => void {
  return (value) => {
    for (const ref of refs) setRef(ref, value);
  };
}

/**
 * Runs the caller's handler and then ours. Order matters: the caller's handler goes FIRST, so a
 * trigger that calls `preventDefault()` or its own `stopPropagation()` is honoured before an
 * overlay decides to open.
 */
export function chain<E>(
  ...handlers: Array<((event: E) => void) | undefined>
): (event: E) => void {
  return (event) => {
    for (const handler of handlers) handler?.(event);
  };
}

/**
 * The props an overlay injects into a cloned trigger element.
 *
 * Exists as a named type because `cloneElement` type-checks its second argument against the
 * element's own prop type: without declaring the injected shape up front, every ARIA attribute
 * below is an excess property and the clone does not compile.
 */
/*
 * Every member is explicitly `| undefined`. The repo runs `exactOptionalPropertyTypes`, under which
 * `foo?: string` REFUSES an explicit `undefined` — and "present only while open" is exactly how
 * `aria-describedby` and `aria-controls` have to behave, because a live ARIA pointer at an id that
 * does not exist is worse than no pointer at all.
 */
export interface AnchorInjectedProps {
  ref?: Ref<HTMLElement> | undefined;
  id?: string | undefined;
  'aria-describedby'?: string | undefined;
  'aria-haspopup'?: 'menu' | undefined;
  'aria-expanded'?: boolean | undefined;
  'aria-controls'?: string | undefined;
  onClick?: ((event: MouseEvent<HTMLElement>) => void) | undefined;
  onKeyDown?: ((event: KeyboardEvent<HTMLElement>) => void) | undefined;
  onMouseEnter?: ((event: MouseEvent<HTMLElement>) => void) | undefined;
  onMouseLeave?: ((event: MouseEvent<HTMLElement>) => void) | undefined;
  onFocus?: ((event: FocusEvent<HTMLElement>) => void) | undefined;
  onBlur?: ((event: FocusEvent<HTMLElement>) => void) | undefined;
}

/**
 * `element.ref` is where React 18 keeps a cloned child's existing ref. It is not on the public
 * `ReactElement` type, hence the cast — narrow, to one optional field, rather than `as any`.
 */
export function refOfElement(element: ReactElement): Ref<HTMLElement> | undefined {
  return (element as ReactElement & { ref?: Ref<HTMLElement> }).ref;
}
