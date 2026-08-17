import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { isRingCentralRoute } from './rcRouteGate';
import { dockRingCentralWidget } from './ringcentralDial';
import {
  bootAdapter,
  lockRcCursor,
  rcAdapterPresent,
  rcFrame,
  teardownAdapter,
} from './rcAdapterHost';
import {
  ringCentralLoginState,
  subscribeRingCentral,
  type RingCentralCallEvent,
} from './ringcentralEvents';
import { nextSignInPrompt } from './signInPrompt';
import { inAppCallingSupported } from './rcCapability';
import { IncomingCallBanner } from './IncomingCallBanner';
import { RcHostUi, type RcToastMsg } from './RcHostUi';
import './ringcentralHost.css';

const LOGOUT_TOAST_GRACE_MS = 2500;
const SIGNED_OUT_CONFIRM_MS = 6000;

let toastId = 0;
let pendingLogoutToast: ReturnType<typeof setTimeout> | null = null;
let signInCardMuted = false;

function clearPendingLogoutToast(): void {
  if (pendingLogoutToast !== null) {
    clearTimeout(pendingLogoutToast);
    pendingLogoutToast = null;
  }
}

function guardLateAdapter(): () => void {
  const guard = new MutationObserver(() => {
    if (rcAdapterPresent()) teardownAdapter();
  });
  guard.observe(document.body, { childList: true, subtree: true });
  return () => guard.disconnect();
}

/**
 * RingCentral Embeddable bootstrap — mounts only on Sales + Customer Service + Collection routes.
 * Lives in WorkerLayout so switching between those Mytrions does not remount the softphone.
 * Telegram WebView never mounts the iframe (WebRTC / OAuth popup); desktop calling is unchanged.
 */
export function RingCentralPhone() {
  const { pathname } = useLocation();
  const allowed = isRingCentralRoute(pathname);
  const callingOk = inAppCallingSupported();

  const [toasts, setToasts] = useState<RcToastMsg[]>([]);
  const [showSignIn, setShowSignIn] = useState(false);

  const addToast = (title: string, message: string) => {
    const id = ++toastId;
    setToasts((prev) => [...prev, { id, type: 'error', title, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 8000);
  };

  const removeToast = (id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  useEffect(() => {
    if (!allowed || !callingOk) {
      clearPendingLogoutToast();
      teardownAdapter();
      setShowSignIn(false);
      setToasts([]);
      return guardLateAdapter();
    }

    let cancelled = false;
    const isCancelled = (): boolean => cancelled;
    let cachedAdapterUrl: string | null = null;

    const boot = async (reason: string): Promise<void> => {
      try {
        cachedAdapterUrl = await bootAdapter(cachedAdapterUrl, {
          cancelled: isCancelled,
          onLoadError: () => {
            if (!cancelled) {
              addToast(
                'RingCentral failed to load',
                'Refresh the page or check your network, then try again.',
              );
            }
          },
        });
        if (!cancelled) {
          window.setTimeout(() => {
            if (!cancelled) dockRingCentralWidget();
          }, 800);
        }
      } catch (err) {
        if (reason === 'visibility' || reason === 'pageshow') {
          console.warn('[ringcentral] recover failed', err);
        }
      }
    };

    void boot('mount');

    let signedOutSince: number | null = null;
    let signInTimer: number | null = null;
    const clearSignInTimer = (): void => {
      if (signInTimer !== null) window.clearTimeout(signInTimer);
      signInTimer = null;
    };
    const evaluateSignIn = (): void => {
      if (cancelled) return;
      const next = nextSignInPrompt({
        state: ringCentralLoginState(),
        signedOutSince,
        muted: signInCardMuted,
        now: Date.now(),
        confirmMs: SIGNED_OUT_CONFIRM_MS,
      });
      signedOutSince = next.signedOutSince;
      signInCardMuted = next.muted;
      setShowSignIn(next.show);
      clearSignInTimer();
      if (!next.show && ringCentralLoginState() !== true) {
        signInTimer = window.setTimeout(evaluateSignIn, SIGNED_OUT_CONFIRM_MS);
      }
    };
    evaluateSignIn();

    const unsubscribe = subscribeRingCentral((event: RingCentralCallEvent) => {
      if (cancelled) return;
      if (event.kind === 'login') {
        signedOutSince = null;
        signInCardMuted = false;
        setShowSignIn(false);
        clearSignInTimer();
        clearPendingLogoutToast();
        return;
      }
      if (event.kind !== 'logout') return;
      signedOutSince = Date.now();
      evaluateSignIn();
      clearPendingLogoutToast();
      pendingLogoutToast = setTimeout(() => {
        pendingLogoutToast = null;
        if (cancelled) return;
        if (ringCentralLoginState() === true) return;
        addToast('RingCentral session ended', 'Open the phone widget and sign in again to place calls.');
      }, LOGOUT_TOAST_GRACE_MS);
    });

    lockRcCursor();
    const cursorObs = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type !== 'childList') continue;
        for (const n of m.addedNodes) {
          if (
            n instanceof HTMLElement &&
            (n.id === 'rc-widget-adapter-frame' || n.querySelector?.('#rc-widget-adapter-frame'))
          ) {
            lockRcCursor();
            dockRingCentralWidget();
            return;
          }
        }
      }
    });
    cursorObs.observe(document.body, { childList: true, subtree: true });

    const onVisible = (): void => {
      if (document.visibilityState !== 'visible') return;
      if (!rcFrame()) void boot('visibility');
    };
    const onPageShow = (e: PageTransitionEvent): void => {
      if (e.persisted || !rcFrame()) void boot('pageshow');
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pageshow', onPageShow);

    return () => {
      cancelled = true;
      clearSignInTimer();
      clearPendingLogoutToast();
      unsubscribe();
      cursorObs.disconnect();
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, [allowed, callingOk]);

  useEffect(() => () => {
    clearPendingLogoutToast();
    teardownAdapter();
  }, []);

  if (!allowed || !callingOk) return null;

  return (
    <>
      <IncomingCallBanner />
      <RcHostUi
        toasts={toasts}
        showSignIn={showSignIn}
        onSignIn={() => {
          signInCardMuted = true;
          setShowSignIn(false);
        }}
        onDismissSignIn={() => {
          signInCardMuted = true;
          setShowSignIn(false);
        }}
        onRemoveToast={removeToast}
      />
    </>
  );
}
