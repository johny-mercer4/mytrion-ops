/**
 * Recover a tab that was open across a deploy.
 *
 * Render serves the COMMITTED bundle, and every build emits new content-hashed filenames while the old
 * ones stop existing. A tab loaded before a deploy is still running the old JS, which references the old
 * chunk names — so the first lazy route import after the deploy asks for a file that is gone. Vite
 * reports that as a `vite:preloadError`, the boundary catches it, and the user sees "Something went
 * wrong" on a click that would have worked a minute earlier.
 *
 * Observed in production as:
 *   Unable to preload CSS for /assets/index-CLy9FzoA.css
 *   Refused to apply style … MIME type ('application/json') is not a supported stylesheet MIME type
 *
 * (The MIME line is the 404 body — the server answers a missing asset with a JSON error envelope. That
 * is fixed separately in `plugins/widgetStatic.ts`; it made the message confusing but was not the cause.)
 *
 * The fix is to reload, because the newest `index.html` is only ever one request away — it is served
 * `no-cache`, so a reload picks up the new build's chunk names immediately.
 */

/** Survives the reload; cleared on a successful load. Without it a permanent 404 would reload forever. */
const FLAG = 'octane.staleBuildReloaded';

export function installStaleBuildReload(): void {
  // A load that got this far is working, so forget any earlier recovery. Doing this on load rather
  // than on a timer is what makes a genuinely-broken asset fail visibly instead of looping.
  window.addEventListener('load', () => {
    try {
      sessionStorage.removeItem(FLAG);
    } catch {
      // Private mode / storage disabled. Reloading once without the guard is still better than a
      // dead click, and the `load` handler above cannot run twice for one document anyway.
    }
  });

  window.addEventListener('vite:preloadError', (event) => {
    let alreadyTried = false;
    try {
      alreadyTried = sessionStorage.getItem(FLAG) === '1';
      sessionStorage.setItem(FLAG, '1');
    } catch {
      alreadyTried = false;
    }
    // Second time in one session: the asset is missing for a reason a reload will not fix (a bad
    // deploy, a broken proxy). Let it through to the error boundary so it is reported, not hidden.
    if (alreadyTried) return;
    event.preventDefault();
    window.location.reload();
  });
}
