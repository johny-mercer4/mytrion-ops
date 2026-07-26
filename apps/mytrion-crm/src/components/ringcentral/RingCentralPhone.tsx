import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { fetchRingCentralEmbedConfig } from '@/api/ringcentral';
import {
  isMytrionId,
  mytrionIdFromUrlSlug,
  type MytrionId,
} from '@/access/mytrions.config';
import { installRcConsoleFilter } from './rcConsoleFilter';
import { RC_ADAPTER_SCRIPT_ID, dockRingCentralWidget } from './ringcentralDial';
import { ringcentralStylesDataUri } from './ringcentralEmbedStyles';
import {
  resetRingCentralLoginState,
  subscribeRingCentral,
  type RingCentralCallEvent,
} from './ringcentralEvents';
import { X, AlertCircle } from 'lucide-react';
import './ringcentralHost.css';

// Install as soon as this module loads — Embeddable can emit AGW-401 before the mount effect
// reaches script injection (persisted session restore / early probes).
installRcConsoleFilter();

/** Softphone is only for desk-phone Mytrions (expand later as needed). */
const RC_ALLOWED_MYTRIONS = new Set<MytrionId>(['sales', 'customer-service']);

/** Ignore brief logged-out blips while Embeddable restores a persisted session. */
const LOGOUT_TOAST_GRACE_MS = 2500;

/** How long to wait for the vendor iframe after injecting adapter.js. */
const FRAME_WAIT_MS = 12_000;
const FRAME_POLL_MS = 200;

type ToastType = 'error';
interface ToastMsg {
  id: number;
  type: ToastType;
  title: string;
  message: string;
}

let toastId = 0;
let pendingLogoutToast: ReturnType<typeof setTimeout> | null = null;

function clearPendingLogoutToast(): void {
  if (pendingLogoutToast !== null) {
    clearTimeout(pendingLogoutToast);
    pendingLogoutToast = null;
  }
}

/** Resolve /main/:slug (or legacy /m/:id) to a MytrionId when on a Mytrion route. */
function mytrionFromPath(pathname: string): MytrionId | undefined {
  const main = /^\/main\/([^/]+)/.exec(pathname);
  if (main?.[1]) return mytrionIdFromUrlSlug(main[1]);
  const legacy = /^\/m\/([^/]+)/.exec(pathname);
  if (legacy?.[1] && isMytrionId(legacy[1])) return legacy[1];
  return undefined;
}

/** Attach cursor CSS as a data: URI — never fetch our origin (localhost is PNA-blocked). */
function withStylesUri(adapterUrl: string): string {
  try {
    const u = new URL(adapterUrl);
    u.searchParams.set('stylesUri', ringcentralStylesDataUri());
    return u.toString();
  } catch {
    return adapterUrl;
  }
}

function forceRcFrameCursor(frame: HTMLElement): void {
  // Adapter may set grab/move inline on the host iframe — beat it with !important.
  frame.style.setProperty('cursor', 'pointer', 'important');
}

function rcFrame(): HTMLElement | null {
  return document.getElementById('rc-widget-adapter-frame');
}

function teardownAdapter(): void {
  clearPendingLogoutToast();
  resetRingCentralLoginState();
  document.getElementById(RC_ADAPTER_SCRIPT_ID)?.remove();
  rcFrame()?.remove();
}

function waitForRcFrame(timeoutMs: number): Promise<HTMLElement | null> {
  const existing = rcFrame();
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = (): void => {
      const frame = rcFrame();
      if (frame) {
        resolve(frame);
        return;
      }
      if (Date.now() - started >= timeoutMs) {
        resolve(null);
        return;
      }
      window.setTimeout(tick, FRAME_POLL_MS);
    };
    tick();
  });
}

/**
 * Inject (or remount) the Embeddable adapter. Remounts when the script tag is present but the
 * iframe is gone — that stuck state is why prod sometimes needs a hard refresh to show Sign in.
 */
async function mountAdapter(
  adapterUrl: string,
  opts: { cancelled: () => boolean; onLoadError: () => void },
): Promise<void> {
  const nextSrc = withStylesUri(adapterUrl);
  const existing = document.getElementById(RC_ADAPTER_SCRIPT_ID) as HTMLScriptElement | null;
  const frame = rcFrame();

  if (existing && frame && existing.src.includes('stylesUri=data')) {
    forceRcFrameCursor(frame);
    dockRingCentralWidget();
    return;
  }

  // Script without iframe (or stale stylesUri) → tear down and inject fresh.
  if (existing || frame) teardownAdapter();
  if (opts.cancelled()) return;

  installRcConsoleFilter();

  await new Promise<void>((resolve) => {
    const script = document.createElement('script');
    script.id = RC_ADAPTER_SCRIPT_ID;
    script.src = nextSrc;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      console.warn('[ringcentral] Embeddable adapter failed to load');
      script.remove();
      opts.onLoadError();
      resolve();
    };
    document.body.appendChild(script);
  });

  if (opts.cancelled()) return;

  const ready = await waitForRcFrame(FRAME_WAIT_MS);
  if (opts.cancelled()) return;
  if (ready) {
    forceRcFrameCursor(ready);
    dockRingCentralWidget();
  } else {
    console.warn('[ringcentral] Embeddable iframe did not appear after adapter inject');
  }
}

/**
 * RingCentral Embeddable bootstrap — mounts only on Sales + Customer Service routes.
 * Lives in WorkerLayout so switching between those two Mytrions does not remount the softphone.
 */
export function RingCentralPhone() {
  const { pathname } = useLocation();
  const allowed = (() => {
    const id = mytrionFromPath(pathname);
    return !!id && RC_ALLOWED_MYTRIONS.has(id);
  })();

  const [toasts, setToasts] = useState<ToastMsg[]>([]);

  const addToast = (type: ToastType, title: string, message: string) => {
    const id = ++toastId;
    setToasts((prev) => [...prev, { id, type, title, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 8000);
  };

  const removeToast = (id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  useEffect(() => {
    if (!allowed) {
      teardownAdapter();
      return;
    }

    let cancelled = false;
    const isCancelled = (): boolean => cancelled;
    let cachedAdapterUrl: string | null = null;

    const boot = async (reason: string): Promise<void> => {
      try {
        if (!cachedAdapterUrl) {
          const cfg = await fetchRingCentralEmbedConfig();
          if (cancelled || !cfg.enabled || !cfg.adapterUrl) return;
          cachedAdapterUrl = cfg.adapterUrl;
        }
        if (cancelled || !cachedAdapterUrl) return;
        await mountAdapter(cachedAdapterUrl, {
          cancelled: isCancelled,
          onLoadError: () => {
            if (!cancelled) {
              addToast(
                'error',
                'RingCentral failed to load',
                'Refresh the page or check your network, then try again.',
              );
            }
          },
        });
        if (!cancelled) {
          // Nudge after vendor init settles — ensure the widget is a visible DOCK, not popped open.
          window.setTimeout(() => {
            if (!cancelled) dockRingCentralWidget();
          }, 800);
        }
      } catch (err) {
        // Widget unavailable (RC disabled / not configured) — fail silently.
        if (reason === 'visibility' || reason === 'pageshow') {
          console.warn('[ringcentral] recover failed', err);
        }
      }
    };

    void boot('mount');

    const unsubscribe = subscribeRingCentral((event: RingCentralCallEvent) => {
      if (cancelled) return;
      if (event.kind === 'login') {
        // Don't pop the widget open on login — leave it docked; the agent opens it when they want.
        clearPendingLogoutToast();
        return;
      }
      if (event.kind !== 'logout') return;
      // Debounce: Embeddable can flap logged-out during session restore after refresh.
      clearPendingLogoutToast();
      pendingLogoutToast = setTimeout(() => {
        pendingLogoutToast = null;
        if (cancelled) return;
        // Toast only — do NOT auto-expand the widget; the agent opens it to sign in again.
        addToast(
          'error',
          'RingCentral session ended',
          'Open the phone widget and sign in again to place calls.',
        );
      }, LOGOUT_TOAST_GRACE_MS);
    });

    const lockCursor = (): void => {
      const frame = rcFrame();
      if (frame) forceRcFrameCursor(frame);
    };
    lockCursor();
    const cursorTimer = window.setInterval(lockCursor, 800);
    const cursorObs = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'childList') {
          for (const n of m.addedNodes) {
            if (
              n instanceof HTMLElement &&
              (n.id === 'rc-widget-adapter-frame' || n.querySelector?.('#rc-widget-adapter-frame'))
            ) {
              lockCursor();
              dockRingCentralWidget();
              return;
            }
          }
        }
        if (
          m.type === 'attributes' &&
          m.target instanceof HTMLElement &&
          m.target.id === 'rc-widget-adapter-frame'
        ) {
          lockCursor();
        }
      }
    });
    cursorObs.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style'],
    });

    /** Prod Zoho: tab blur / bfcache / CRM soft-nav can drop the iframe while the script stays. */
    const onVisible = (): void => {
      if (document.visibilityState !== 'visible') return;
      // Re-boot only if the iframe was dropped. If it's still there, leave the widget exactly as the
      // agent left it — never auto-expand on tab focus (that was the main "keeps popping" cause).
      if (!rcFrame()) void boot('visibility');
    };
    const onPageShow = (e: PageTransitionEvent): void => {
      if (e.persisted || !rcFrame()) void boot('pageshow');
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pageshow', onPageShow);

    return () => {
      cancelled = true;
      clearPendingLogoutToast();
      unsubscribe();
      window.clearInterval(cursorTimer);
      cursorObs.disconnect();
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pageshow', onPageShow);
      // Softphone stays mounted across Sales ↔ CS (allowed stays true).
    };
  }, [allowed]);

  // Full unmount (logout / leave worker portal) always tears down the vendor iframe.
  useEffect(() => () => teardownAdapter(), []);

  if (toasts.length === 0) return null;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '24px',
        left: '24px',
        zIndex: 999999,
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
      }}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          style={{
            background: 'var(--surface)',
            borderLeft: '4px solid var(--danger)',
            padding: '12px 16px',
            borderRadius: '6px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '12px',
            minWidth: '280px',
            color: 'var(--text)',
          }}
        >
          <AlertCircle size={20} color="var(--danger)" />

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div style={{ fontWeight: 600, fontSize: '14px' }}>{t.title}</div>
            <div style={{ fontSize: '13px', color: 'var(--muted)' }}>{t.message}</div>
          </div>

          <button
            type="button"
            onClick={() => removeToast(t.id)}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--muted)',
              cursor: 'pointer',
              padding: '2px',
              display: 'flex',
            }}
          >
            <X size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}
