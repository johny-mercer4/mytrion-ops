/**
 * The viewport, as a hook.
 *
 * THE LADDER IS FOUR NUMBERS AND THIS IS WHERE THEY LIVE IN TS. CSS cannot read them — a custom
 * property is not legal in an `@media` condition — so the same four literals are written out in the
 * stylesheets and `src/styles/breakpoints.test.ts` asserts the two copies agree. That test is the
 * join; without it the hook and the CSS drift and a component starts branching at a width its own
 * stylesheet does not.
 *
 *   sm / 640  the STRUCTURE line — rail becomes a tab bar, modals become sheets, tables become
 *             cards. Everything that changes the shape of the page happens here and nowhere else.
 *   md / 900  the DENSITY line — the rail is forced to its collapsed 68px form, gutters go compact,
 *             inputs go to 16px. Nothing moves; things get tighter.
 *
 * Two lines rather than one because an iPad in portrait is 810–834px: a single switch either forces
 * the phone shell onto every tablet and split-screen laptop, or leaves tablets behind a 248px rail
 * with 572px of content. The band between them is served by a collapsed rail that already shipped.
 *
 * WHY `useSyncExternalStore` and not `useState` + `useEffect`: the effect version renders once with
 * a guessed value and again with the real one, which is a visible flash when the guess is "desktop"
 * and the device is a phone. It also double-subscribes under StrictMode. This reads the real value
 * on the first render and gives `getServerSnapshot` for free.
 */
import { useCallback, useSyncExternalStore } from 'react';

export const BREAKPOINT = {
  /** small phone — 2-up grids go 1-up, sheet gutters tighten */
  xs: 480,
  /** STRUCTURE — rail → tab bar + sheet, modal → sheet, table → cards */
  sm: 640,
  /** DENSITY — rail forced collapsed, compact gutters, 16px inputs */
  md: 900,
  /** wide-desktop only — multi-column dashboards */
  lg: 1200,
} as const;

export type Breakpoint = keyof typeof BREAKPOINT;

/**
 * One MediaQueryList per query, shared by every component asking it. Twenty rows each subscribing
 * to `(width < 640px)` is one native listener, not twenty.
 */
const lists = new Map<string, MediaQueryList>();

function listFor(query: string): MediaQueryList | null {
  // Absent in jsdom without the stub in src/test/setup.ts, and absent in the design-tool sandbox
  // the `ds` library build ships into. Both must resolve to "desktop" rather than throw.
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  const cached = lists.get(query);
  if (cached) return cached;
  const created = window.matchMedia(query);
  lists.set(query, created);
  return created;
}

const NEVER_MATCHES = (): boolean => false;
const NO_SUBSCRIPTION = (): void => undefined;

/**
 * Subscribe to a raw media query. Prefer `useBelow` / `useIsPhone` / `useIsCompact` — a literal
 * width written at a call site is exactly the drift `breakpoints.test.ts` exists to stop.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const list = listFor(query);
      if (!list) return NO_SUBSCRIPTION;
      // `addListener` is the Safari < 14 spelling; this app floors at 16.2 via color-mix().
      list.addEventListener('change', onStoreChange);
      return () => list.removeEventListener('change', onStoreChange);
    },
    [query],
  );

  const getSnapshot = useCallback(() => listFor(query)?.matches ?? false, [query]);

  return useSyncExternalStore(subscribe, getSnapshot, NEVER_MATCHES);
}

/**
 * True below the named rung. Range syntax, matching the stylesheets — `(width < 640px)` excludes
 * 640 itself, where `(max-width: 640px)` would include it. That off-by-one is not academic: the
 * shell used to switch at `max-width: 768px` while `ds/*` guarded at `max-width: 767px`, so a
 * viewport exactly 768px wide got the mobile shell with 13px inputs and iOS auto-zoomed the page.
 */
export function useBelow(bp: Breakpoint): boolean {
  return useMediaQuery(`(width < ${BREAKPOINT[bp]}px)`);
}

/** Below the structure line: no rail, no centred modals, no tables. */
export function useIsPhone(): boolean {
  return useBelow('sm');
}

/** Below the density line: collapsed rail, compact gutters, 16px inputs. Includes every phone. */
export function useIsCompact(): boolean {
  return useBelow('md');
}

/**
 * A real pointer that can hover. Use to decide whether an affordance may be hover-only — never to
 * infer "is mobile", which is what the width is for. A touchscreen laptop is both.
 */
export function useHasHover(): boolean {
  return useMediaQuery('(hover: hover) and (pointer: fine)');
}
