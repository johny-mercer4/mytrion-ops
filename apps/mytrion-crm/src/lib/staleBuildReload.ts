/**
 * Recover a tab that was open across a deploy.
 *
 * Render serves the COMMITTED bundle. The entry is hashless (`assets/index.js`) so two widget
 * rebuilds do not fight over index.html paths. Content still changes; we detect a new deploy by
 * comparing `window.__OCTANE_BUILD__` (stamped by the Vite plugin) or, on older deploys, the
 * hashed `assets/index-XXXX.js` filename. index.html is `no-cache`; the hashless entry is too.
 *
 * Two ways a worker stays on the old code:
 *
 * 1. They click a lazy route whose chunk is gone. Vite reports `vite:preloadError`.
 * 2. They stay on an already-mounted page (Home). No lazy import fails. We re-fetch on a slow
 *    interval and reload once when the build id changes.
 *
 * A reload picks up the new entry immediately. The session flag stops a broken deploy from
 * looping. We do not check on every focus — Telegram WebView treats a reload as a full reopen.
 */

/** Survives the reload; cleared on a successful load. Without it a permanent 404 would reload forever. */
export const STALE_BUILD_FLAG = 'octane.staleBuildReloaded';
const FIRST_CHECK_MS = 45_000;
const CHECK_EVERY_MS = 5 * 60_000;
const ENTRY_SCRIPT = /(?:^|\/)assets\/index-[^/"'?#]+\.js(?:[?#]|$)/;
const STABLE_ENTRY = /(?:^|\/)assets\/index\.js(?:[?#]|$)/;
const META_BUILD =
  /<meta\b[^>]*\bname=["']octane-build["'][^>]*\bcontent=["']([^"']+)["'][^>]*>/i;
const META_BUILD_ALT =
  /<meta\b[^>]*\bcontent=["']([^"']+)["'][^>]*\bname=["']octane-build["'][^>]*>/i;
const EMBEDDED_BUILD = /(?:window\.)?__OCTANE_BUILD__\s*=\s*["']([^"']+)["']/;

export function normalizeAssetRef(src: string): string {
  const path = src.includes('://') ? new URL(src).pathname : src;
  return path.replace(/^\.\//, '').replace(/^\//, '');
}

function scriptSrcs(html: string): string[] {
  return [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)].map(
    (match) => match[1] ?? '',
  );
}

/** Build id from deployed HTML, entry JS, or a meta tag. Null in Vite dev (`/src/main.tsx`). */
export function extractIndexBuildId(source: string): string | null {
  const meta = source.match(META_BUILD) ?? source.match(META_BUILD_ALT);
  if (meta?.[1]) return meta[1];
  const embedded = source.match(EMBEDDED_BUILD);
  if (embedded?.[1]) return embedded[1];
  const hashed = scriptSrcs(source).find((src) => ENTRY_SCRIPT.test(src));
  return hashed ? normalizeAssetRef(hashed) : null;
}

function windowBuildId(): string | null {
  const value = Reflect.get(window, '__OCTANE_BUILD__');
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function currentDocumentBuildId(doc: ParentNode = document): string | null {
  if ('querySelector' in doc) {
    const content = doc.querySelector('meta[name="octane-build"]')?.getAttribute('content');
    if (content) return content;
  }
  if (doc === document) {
    const embedded = windowBuildId();
    if (embedded) return embedded;
  }
  for (const el of doc.querySelectorAll('script[src]')) {
    const raw = el.getAttribute('src') ?? '';
    if (ENTRY_SCRIPT.test(raw)) return normalizeAssetRef(raw);
  }
  return null;
}

export function staleBuildDecision(
  current: string | null,
  incoming: string | null,
  alreadyReloaded: boolean,
): 'reload' | 'skip' {
  if (alreadyReloaded || !current || !incoming || current === incoming) return 'skip';
  return 'reload';
}

export async function checkDeployedBuild(opts: {
  current: string | null;
  alreadyReloaded: boolean;
  fetchHtml: () => Promise<string>;
  fetchEntry?: () => Promise<string>;
}): Promise<'reload' | 'skip'> {
  if (opts.alreadyReloaded || !opts.current) return 'skip';
  try {
    const html = await opts.fetchHtml();
    let incoming = extractIndexBuildId(html);
    if (!incoming && opts.fetchEntry && scriptSrcs(html).some((src) => STABLE_ENTRY.test(src))) {
      incoming = extractIndexBuildId(await opts.fetchEntry());
    }
    return staleBuildDecision(opts.current, incoming, false);
  } catch {
    return 'skip';
  }
}

function flagSet(): boolean {
  try {
    return sessionStorage.getItem(STALE_BUILD_FLAG) === '1';
  } catch {
    return false;
  }
}

function markFlag(): boolean {
  const already = flagSet();
  try {
    sessionStorage.setItem(STALE_BUILD_FLAG, '1');
  } catch {
    // Private mode: still reload once; `load` cannot run twice for one document.
  }
  return already;
}

function clearFlag(): void {
  try {
    sessionStorage.removeItem(STALE_BUILD_FLAG);
  } catch {
    // Private mode / storage disabled.
  }
}

async function fetchText(path: string, accept: string): Promise<string> {
  const res = await fetch(path, { cache: 'no-store', headers: { Accept: accept } });
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  return res.text();
}

export function installStaleBuildReload(): () => void {
  // A load that got this far is working, so forget any earlier recovery. Doing this on load rather
  // than on a timer is what makes a genuinely-broken asset fail visibly instead of looping.
  const onLoad = (): void => {
    clearFlag();
  };
  window.addEventListener('load', onLoad);

  const onPreloadError = (event: Event): void => {
    if (markFlag()) return;
    event.preventDefault();
    window.location.reload();
  };
  window.addEventListener('vite:preloadError', onPreloadError);

  let lastCheckAt = 0;
  const tick = (): void => {
    if (document.visibilityState !== 'visible') return;
    if (Date.now() - lastCheckAt < CHECK_EVERY_MS) return;
    lastCheckAt = Date.now();
    void checkDeployedBuild({
      current: currentDocumentBuildId(),
      alreadyReloaded: flagSet(),
      fetchHtml: () => fetchText('/index.html', 'text/html'),
      fetchEntry: () => fetchText('/assets/index.js', '*/*'),
    }).then((action) => {
      if (action !== 'reload' || markFlag()) return;
      window.location.reload();
    });
  };

  const first = window.setTimeout(tick, FIRST_CHECK_MS);
  const interval = window.setInterval(tick, CHECK_EVERY_MS);
  document.addEventListener('visibilitychange', tick);

  return () => {
    window.removeEventListener('load', onLoad);
    window.removeEventListener('vite:preloadError', onPreloadError);
    document.removeEventListener('visibilitychange', tick);
    window.clearTimeout(first);
    window.clearInterval(interval);
  };
}
