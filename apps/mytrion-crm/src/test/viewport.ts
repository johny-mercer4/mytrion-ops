/**
 * A `matchMedia` that actually evaluates the query.
 *
 * jsdom implements no CSSOM view module: `window.matchMedia` and `window.visualViewport` are both
 * `undefined`. Anything that branches on the viewport therefore throws in a test unless something
 * installs a stub — which is why `MytrionShell.test.tsx` grew a local `vi.fn()` returning a constant
 * `matches`. A constant is enough while exactly one component asks exactly one question. It stops
 * being enough the moment the shell asks "< 640px?", ds/DataTable asks "< 900px?" and ds/Input asks
 * "< 900px?" of the same render: a single boolean cannot answer three different questions, and a test
 * that mocks one of them ends up asserting a viewport that could not exist.
 *
 * So this parses the query and compares it against a settable width. A test says `setViewport(375)`
 * once and every consumer agrees about what that means.
 *
 * THE DEFAULT IS DESKTOP, deliberately. The suite was written against `matches: false`; changing the
 * default would silently re-render 93 files' worth of assertions against a layout they were never
 * written for.
 *
 * Unknown features evaluate to `false` — which is what a real browser does with a feature it does not
 * support, so a query this stub has not learned degrades the same way it would in the wild rather
 * than throwing from a shared setup file and taking unrelated suites down with it.
 */

/** Wide enough to sit above every rung of the ladder. */
export const DESKTOP_WIDTH = 1280;

interface ViewportEnv {
  width: number;
  hover: 'hover' | 'none';
  pointer: 'fine' | 'coarse';
  reducedMotion: boolean;
}

const env: ViewportEnv = {
  width: DESKTOP_WIDTH,
  hover: 'hover',
  pointer: 'fine',
  reducedMotion: false,
};

/** Every live list, so a width change can re-evaluate and notify the ones that actually flipped. */
const live = new Set<StubMediaQueryList>();

function compare(left: number, op: string, right: number): boolean {
  switch (op) {
    case '<':
      return left < right;
    case '<=':
      return left <= right;
    case '>':
      return left > right;
    case '>=':
      return left >= right;
    case '=':
      return left === right;
    default:
      return false;
  }
}

const RANGE_LEADING = /^(\d+(?:\.\d+)?)px\s*(<=|>=|<|>)\s*width(?:\s*(<=|>=|<|>)\s*(\d+(?:\.\d+)?)px)?$/;
const RANGE_TRAILING = /^width\s*(<=|>=|<|>|=)\s*(\d+(?:\.\d+)?)px$/;
const LEGACY_WIDTH = /^(max|min)-width\s*:\s*(\d+(?:\.\d+)?)px$/;
/** `640px < width` is the same constraint as `width > 640px`, written from the other side. */
const MIRROR_OP: Record<string, string> = { '<': '>', '<=': '>=', '>': '<', '>=': '<=' };

const DISCRETE = /^([a-z-]+)\s*:\s*([a-z-]+)$/;

/** One parenthesised feature, parens already stripped. */
function evaluateFeature(feature: string): boolean {
  const text = feature.trim().toLowerCase();

  // `640px <= width`, `640px <= width < 900px`
  const leading = RANGE_LEADING.exec(text);
  if (leading) {
    const [, lowRaw, lowOp, highOp, highRaw] = leading;
    if (lowRaw === undefined || lowOp === undefined) return false;
    // `640px < width` reads "640 is less than width". Every comparison below is written
    // width-first, so the leading operator has to be mirrored to keep the same meaning.
    const flipped = MIRROR_OP[lowOp];
    if (flipped === undefined) return false;
    if (!compare(env.width, flipped, Number(lowRaw))) return false;
    if (highOp === undefined || highRaw === undefined) return true;
    return compare(env.width, highOp, Number(highRaw));
  }

  // `width < 640px`
  const trailing = RANGE_TRAILING.exec(text);
  if (trailing) {
    const [, op, raw] = trailing;
    if (op === undefined || raw === undefined) return false;
    return compare(env.width, op, Number(raw));
  }

  // `max-width: 768px` — inclusive on both sides, per spec.
  const legacy = LEGACY_WIDTH.exec(text);
  if (legacy) {
    const [, kind, raw] = legacy;
    if (kind === undefined || raw === undefined) return false;
    return compare(env.width, kind === 'max' ? '<=' : '>=', Number(raw));
  }

  const discrete = DISCRETE.exec(text);
  if (discrete) {
    const [, name, value] = discrete;
    switch (name) {
      case 'hover':
        return env.hover === value;
      case 'pointer':
        return env.pointer === value;
      case 'prefers-reduced-motion':
        return value === 'reduce' ? env.reducedMotion : !env.reducedMotion;
      default:
        return false;
    }
  }

  return false;
}

function evaluate(query: string): boolean {
  // `screen and (...)` / `all and (...)` — the media type is irrelevant in jsdom.
  const conditions = query
    .replace(/^\s*(?:screen|all|print)\s+and\s+/i, '')
    .split(/\s+and\s+/i)
    .map((part) => part.trim().replace(/^\(/, '').replace(/\)$/, ''))
    .filter((part) => part.length > 0);

  if (conditions.length === 0) return false;
  return conditions.every(evaluateFeature);
}

type ChangeListener = (event: MediaQueryListEvent) => void;

class StubMediaQueryList implements MediaQueryList {
  readonly media: string;
  matches: boolean;
  onchange: ((this: MediaQueryList, ev: MediaQueryListEvent) => unknown) | null = null;

  private readonly listeners = new Set<ChangeListener>();

  constructor(media: string) {
    this.media = media;
    this.matches = evaluate(media);
    live.add(this);
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void {
    if (type !== 'change' || listener === null) return;
    this.listeners.add(toChangeListener(listener));
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void {
    if (type !== 'change' || listener === null) return;
    this.listeners.delete(toChangeListener(listener));
  }

  /** Safari < 14. Present so a consumer that feature-detects it does not take a different path. */
  addListener(listener: ChangeListener | null): void {
    if (listener) this.listeners.add(listener);
  }

  removeListener(listener: ChangeListener | null): void {
    if (listener) this.listeners.delete(listener);
  }

  dispatchEvent(event: Event): boolean {
    const mqEvent = event as MediaQueryListEvent;
    for (const listener of this.listeners) listener(mqEvent);
    this.onchange?.call(this, mqEvent);
    return true;
  }

  /** Re-evaluate; notify only if the answer actually changed, exactly like a real MediaQueryList. */
  refresh(): void {
    const next = evaluate(this.media);
    if (next === this.matches) return;
    this.matches = next;
    this.dispatchEvent({ matches: next, media: this.media } as MediaQueryListEvent);
  }
}

/**
 * `removeEventListener` has to be able to find the entry `addEventListener` stored, so an object
 * listener must map to the same function both times.
 */
const handleEventCache = new WeakMap<object, ChangeListener>();
function toChangeListener(listener: EventListenerOrEventListenerObject): ChangeListener {
  if (typeof listener === 'function') return listener as ChangeListener;
  const cached = handleEventCache.get(listener);
  if (cached) return cached;
  const bound: ChangeListener = (event) => listener.handleEvent(event);
  handleEventCache.set(listener, bound);
  return bound;
}

/** Install the stub. Called once from `src/test/setup.ts`; safe to call again. */
export function installViewportStubs(): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string): MediaQueryList => new StubMediaQueryList(query),
  });

  // `useViewportInset` subscribes to this. Absent in jsdom, so the hook must find something to
  // subscribe to or its guard is the only branch a test can ever reach.
  Object.defineProperty(window, 'visualViewport', {
    configurable: true,
    writable: true,
    value: Object.assign(new EventTarget(), {
      width: env.width,
      height: 800,
      offsetLeft: 0,
      offsetTop: 0,
      pageLeft: 0,
      pageTop: 0,
      scale: 1,
      onresize: null,
      onscroll: null,
    }),
  });

  // jsdom's own `innerWidth` is 1024, which is below the density line. Left alone, the handful of
  // places that read it directly (copyToast) would disagree with every media query on the page.
  setViewport(DESKTOP_WIDTH);
}

/**
 * Point the whole app at a viewport width and notify every subscriber whose answer changed.
 *
 * Call it before `render`. Calling it after works too — the change events fire synchronously, so a
 * `useSyncExternalStore` subscriber re-renders — but wrap that call in `act()`.
 */
export function setViewport(
  width: number,
  options: { hover?: 'hover' | 'none'; pointer?: 'fine' | 'coarse' } = {},
): void {
  env.width = width;
  // A phone is a coarse pointer with no hover unless a test says otherwise. Deriving it here means a
  // test that sets 375 does not also have to remember to say "and no hover" for the two to agree.
  env.hover = options.hover ?? (width < 640 ? 'none' : 'hover');
  env.pointer = options.pointer ?? (width < 640 ? 'coarse' : 'fine');

  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
  const vv = window.visualViewport;
  if (vv) Object.defineProperty(vv, 'width', { configurable: true, writable: true, value: width });

  for (const list of live) list.refresh();
}

/**
 * Per-test cleanup. `setup.ts` calls this in `afterEach`, so no suite inherits another's viewport.
 *
 * Deliberately does NOT clear `live`. `useMediaQuery` caches its MediaQueryList by query string at
 * module scope, so a list dropped here would never be refreshed again and every subsequent test in
 * the file would read a frozen `matches`. The set grows by one per distinct query per file, which
 * Vitest's per-file module registry bounds to nothing worth reclaiming.
 */
export function resetViewport(): void {
  env.reducedMotion = false;
  setViewport(DESKTOP_WIDTH);
}

/** For the reduced-motion contract in `themeContext`. */
export function setReducedMotion(reduce: boolean): void {
  env.reducedMotion = reduce;
  for (const list of live) list.refresh();
}
