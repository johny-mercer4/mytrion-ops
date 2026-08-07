/**
 * Manager view state, in the URL.
 *
 * ManagerShell has no router — it is a flat `useState<ManagerViewId>` — so before this, a reload
 * dropped you on Overview and there was no way to hand someone "look at carrier 5724546 with me".
 * For a tool whose daily job is exactly that, in-memory-only state is a real cost.
 *
 * The query string is the single source of truth, written with `replaceState` for within-view
 * changes (a tab switch is not a new page) and `pushState` for a view change (so Back returns to
 * the roster rather than leaving the Mytrion). Everything is optional and unknown values are
 * ignored, so an old or hand-edited link degrades to Overview instead of erroring.
 *
 * Shared by all three cards deliberately: three cards is the cheap moment to do this once, and
 * three cards each inventing their own scheme is the expensive alternative.
 */

export interface ManagerUrlState {
  /** The active view — a card id or a department id. Absent means Overview. */
  view: string | null;
  /** EFS Console: selected carrier. */
  carrier: string | null;
  /** EFS Console: selected dossier tab. */
  tab: string | null;
}

const KEYS = { view: 'card', carrier: 'carrier', tab: 'tab' } as const;

function currentParams(): URLSearchParams {
  if (typeof window === 'undefined') return new URLSearchParams();
  return new URLSearchParams(window.location.search);
}

export function readManagerUrlState(): ManagerUrlState {
  const params = currentParams();
  const get = (key: string): string | null => {
    const value = params.get(key);
    return value && value.trim() ? value.trim() : null;
  };
  return { view: get(KEYS.view), carrier: get(KEYS.carrier), tab: get(KEYS.tab) };
}

/**
 * Write the state back.
 *
 * Only the keys this module owns are touched — anything else already on the URL (the Zoho OAuth
 * callback's `code`, a `?debug=` someone added) survives untouched, because clobbering the whole
 * query string here would break the auth handshake.
 */
export function writeManagerUrlState(next: ManagerUrlState, mode: 'push' | 'replace'): void {
  if (typeof window === 'undefined') return;
  const params = currentParams();
  const set = (key: string, value: string | null): void => {
    if (value) params.set(key, value);
    else params.delete(key);
  };
  set(KEYS.view, next.view);
  set(KEYS.carrier, next.carrier);
  set(KEYS.tab, next.tab);

  const query = params.toString();
  const url = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
  if (url === `${window.location.pathname}${window.location.search}${window.location.hash}`) return;
  if (mode === 'push') window.history.pushState(null, '', url);
  else window.history.replaceState(null, '', url);
}
