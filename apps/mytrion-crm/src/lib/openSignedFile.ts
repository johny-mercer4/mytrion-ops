/**
 * Open a stored file in a new tab, given something that resolves its short-lived URL.
 *
 * THE POINT OF THIS FILE: the tab is claimed BEFORE the await.
 *
 * `window.open` is only honoured while the browser still attributes it to a user gesture. Once an
 * `await` has resolved, Safari and Firefox have ended that window and silently discard the call —
 * so `const { url } = await getLink(); window.open(url)` works in Chrome and does nothing anywhere
 * else. That is the difference between "the attachment opens" and "the attachment opens sometimes",
 * and it is invisible to whoever wrote it if they use Chrome.
 *
 * The correct shape is: open a blank tab synchronously inside the handler, resolve the URL, then
 * point the tab at it. `RecordsTab` already does this by hand for the Telegram mini-app; this is the
 * same manoeuvre, shared, so every attachment surface inherits it instead of rediscovering it.
 */

export interface OpenSignedFileOptions {
  /**
   * Telegram / in-app WebViews have no tab to open. When this returns true the caller's own
   * delivery path is used instead — see `deliverExport`.
   */
  fallback?: (() => Promise<void>) | undefined;
  shouldUseFallback?: (() => boolean) | undefined;
}

export async function openSignedFile(
  resolveUrl: () => Promise<string>,
  opts: OpenSignedFileOptions = {},
): Promise<void> {
  if (opts.shouldUseFallback?.() && opts.fallback) {
    await opts.fallback();
    return;
  }

  /**
   * Claimed here, while the click is still live. Everything after this point may take a network
   * round trip — Dropbox's get_temporary_link is a real request, not a local signature.
   *
   * NO FEATURES STRING. Passing `noopener` (or `noreferrer`, which implies it) makes the HTML spec's
   * window-open steps `return null` — the tab is still created, but you get no handle to it. The
   * first cut of this file passed 'noopener,noreferrer' and so was inert: `tab` was always null,
   * every click leaked an orphan about:blank, and the code fell through to navigating the user's
   * OWN tab at the file. Sever `opener` by hand instead, which is what gives the same protection
   * while keeping the handle. `RecordsTab.tsx` has done it this way for the Telegram mini-app all
   * along.
   */
  const tab = window.open('about:blank', '_blank');
  if (tab) tab.opener = null;

  try {
    const url = await resolveUrl();
    if (tab) {
      // `replace`, not assignment: the blank page should not become a history entry the user can
      // navigate back to.
      tab.location.replace(url);
    } else {
      // Popup blocked outright, or no window (tests, SSR). Navigating the current tab is worse than
      // a new one but far better than the click doing nothing at all.
      window.location.href = url;
    }
  } catch (err) {
    tab?.close();
    throw err;
  }
}
