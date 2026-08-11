/**
 * Marketing view state, in the URL.
 *
 * Same rationale as Manager's: the shell has no router, so without this a reload drops you on the
 * default tab and there is no way to hand someone a link to what you are looking at.
 *
 * `?tab=` rather than Manager's `?card=` — these are nav rows, not hub cards, and Manager's old
 * `?card=referrals` / `?card=loyalty` links are redirected here by ManagerShell.
 *
 * Only the one key this module owns is touched, so anything else on the URL (the Zoho OAuth
 * callback's `code`, a hand-added `?debug=`) survives — clobbering the query string would break the
 * auth handshake.
 */

const KEY = 'tab';

function currentParams(): URLSearchParams {
  if (typeof window === 'undefined') return new URLSearchParams();
  return new URLSearchParams(window.location.search);
}

/** The active tab from the URL, or null when absent/blank. Unknown values are the caller's problem. */
export function readMarketingUrlState(): string | null {
  const value = currentParams().get(KEY);
  return value && value.trim() ? value.trim() : null;
}

export function writeMarketingUrlState(next: string | null, mode: 'push' | 'replace'): void {
  if (typeof window === 'undefined') return;
  const params = currentParams();
  if (next) params.set(KEY, next);
  else params.delete(KEY);

  const query = params.toString();
  const url = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
  if (url === `${window.location.pathname}${window.location.search}${window.location.hash}`) return;
  if (mode === 'push') window.history.pushState(null, '', url);
  else window.history.replaceState(null, '', url);
}
