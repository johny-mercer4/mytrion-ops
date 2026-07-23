import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { fetchRingCentralEmbedConfig } from '@/api/ringcentral';
import {
  isMytrionId,
  mytrionIdFromUrlSlug,
  type MytrionId,
} from '@/access/mytrions.config';
import { installRcConsoleFilter } from './rcConsoleFilter';
import { RC_ADAPTER_SCRIPT_ID } from './ringcentralDial';
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

function teardownAdapter(): void {
  clearPendingLogoutToast();
  resetRingCentralLoginState();
  document.getElementById(RC_ADAPTER_SCRIPT_ID)?.remove();
  document.getElementById('rc-widget-adapter-frame')?.remove();
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

    // Keep host iframe cursor on pointer (vendor re-applies grab/move on the docked pill).
    const lockCursor = (): void => {
      const frame = document.getElementById('rc-widget-adapter-frame');
      if (frame) forceRcFrameCursor(frame);
    };

    void (async () => {
      try {
        const cfg = await fetchRingCentralEmbedConfig();
        if (cancelled || !cfg.enabled || !cfg.adapterUrl) return;

        const nextSrc = withStylesUri(cfg.adapterUrl);
        const existing = document.getElementById(RC_ADAPTER_SCRIPT_ID) as HTMLScriptElement | null;
        // Remount when cursor CSS (stylesUri) is missing from an older adapter inject.
        if (existing) {
          if (existing.src.includes('stylesUri=data')) {
            lockCursor();
            return;
          }
          teardownAdapter();
        }

        installRcConsoleFilter();

        const script = document.createElement('script');
        script.id = RC_ADAPTER_SCRIPT_ID;
        script.src = nextSrc;
        script.async = true;
        script.onerror = () => {
          console.warn('[ringcentral] Embeddable adapter failed to load');
          script.remove();
          if (!cancelled) {
            addToast(
              'error',
              'RingCentral failed to load',
              'Refresh the page or check your network, then try again.',
            );
          }
        };
        document.body.appendChild(script);
      } catch {
        // Widget unavailable (RC disabled / not configured) — fail silently.
      }
    })();

    const unsubscribe = subscribeRingCentral((event: RingCentralCallEvent) => {
      if (cancelled) return;
      if (event.kind === 'login') {
        clearPendingLogoutToast();
        return;
      }
      if (event.kind !== 'logout') return;
      // Debounce: Embeddable can flap logged-out during session restore after refresh.
      clearPendingLogoutToast();
      pendingLogoutToast = setTimeout(() => {
        pendingLogoutToast = null;
        if (cancelled) return;
        addToast(
          'error',
          'RingCentral session ended',
          'Open the phone widget and sign in again to place calls.',
        );
      }, LOGOUT_TOAST_GRACE_MS);
    });

    lockCursor();
    const cursorTimer = window.setInterval(lockCursor, 800);
    const cursorObs = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'childList') {
          for (const n of m.addedNodes) {
            if (n instanceof HTMLElement && (n.id === 'rc-widget-adapter-frame' || n.querySelector?.('#rc-widget-adapter-frame'))) {
              lockCursor();
              return;
            }
          }
        }
        if (m.type === 'attributes' && m.target instanceof HTMLElement && m.target.id === 'rc-widget-adapter-frame') {
          lockCursor();
        }
      }
    });
    cursorObs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });

    return () => {
      cancelled = true;
      clearPendingLogoutToast();
      unsubscribe();
      window.clearInterval(cursorTimer);
      cursorObs.disconnect();
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
