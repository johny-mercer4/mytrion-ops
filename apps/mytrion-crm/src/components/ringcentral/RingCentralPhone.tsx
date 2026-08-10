import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { fetchRingCentralEmbedConfig } from '@/api/ringcentral';
import { installRcConsoleFilter } from './rcConsoleFilter';
import { isRingCentralRoute } from './rcRouteGate';
import {
  RC_ADAPTER_SCRIPT_ID,
  dockRingCentralWidget,
  revealRingCentralWidget,
} from './ringcentralDial';
import { ringcentralStylesDataUri } from './ringcentralEmbedStyles';
import {
  resetRingCentralLoginState,
  ringCentralLoginState,
  subscribeRingCentral,
  type RingCentralCallEvent,
} from './ringcentralEvents';
import { nextSignInPrompt } from './signInPrompt';
import { X, AlertCircle, Phone } from 'lucide-react';
import './ringcentralHost.css';

// Install as soon as this module loads — Embeddable can emit AGW-401 before the mount effect
// reaches script injection (persisted session restore / early probes).
installRcConsoleFilter();

/** Ignore brief logged-out blips while Embeddable restores a persisted session. */
const LOGOUT_TOAST_GRACE_MS = 2500;

/**
 * How long the widget must CONTINUOUSLY report signed-out before we say so.
 *
 * The vendor restores a persisted session asynchronously and reports `loggedIn:false` first, so
 * anything shorter than this flashes a false "sign in" prompt on every page load. Never shorten it
 * below the vendor's restore window.
 */
const SIGNED_OUT_CONFIRM_MS = 6000;

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

/**
 * "Stop telling me" — module-level on purpose, so it survives a remount.
 *
 * `allowed` flips every time the agent hops out of Sales/CS, which re-runs the mount effect and used
 * to reset a per-component dismissal, so the card returned on every navigation no matter how many
 * times it was closed. Cleared the moment a signed-in state is observed, so a genuine later logout
 * still gets to prompt.
 */
let signInCardMuted = false;

function clearPendingLogoutToast(): void {
  if (pendingLogoutToast !== null) {
    clearTimeout(pendingLogoutToast);
    pendingLogoutToast = null;
  }
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

/**
 * The vendor's docked pill, and the thing that actually has to go.
 *
 * Embeddable renders `#rc-widget.Adapter_root.Adapter_right` — a positioned DIV wrapper — and puts
 * the iframe INSIDE it. `ringcentralHost.css` records the same finding for the mobile offset rule
 * ("Targeting only the iframe … moved nothing. Verified against the running app"). Teardown used to
 * remove only the script and the iframe, so the wrapper survived every navigation and the softphone
 * stayed visible on Billing, HR and the launcher.
 */
function rcWidgetRoot(): HTMLElement | null {
  return document.getElementById('rc-widget');
}

/** Any trace of the adapter — the predicate teardown and the late-arrival guard both key on. */
function rcAdapterPresent(): boolean {
  return (
    document.getElementById(RC_ADAPTER_SCRIPT_ID) !== null ||
    rcWidgetRoot() !== null ||
    rcFrame() !== null
  );
}

/**
 * Remove, never hide.
 *
 * `display: none` would leave the iframe alive, and no browser suspends an iframe's JS, its WebRTC
 * session or its audio for being hidden — the softphone would keep its SIP registration and keep
 * ringing on a Mytrion it is not supposed to exist on. That is the reported symptom, not a cosmetic
 * one.
 *
 * Script first, so a still-executing vendor bootstrap cannot re-append into a node we have already
 * dropped in the same tick; the MutationObserver in the disallowed branch catches later arrivals.
 */
function teardownAdapter(): void {
  clearPendingLogoutToast();
  resetRingCentralLoginState();
  document.getElementById(RC_ADAPTER_SCRIPT_ID)?.remove();
  rcWidgetRoot()?.remove(); // takes the iframe with it
  rcFrame()?.remove(); // fallback if the vendor ever reparents the frame
  // The vendor assigns this on every boot, and we always re-inject adapter.js after a teardown, so
  // dropping it is safe. Leaving it meant `clickToDial` could find a live-looking API on a widget
  // whose iframe no longer exists.
  delete window.RCAdapter;
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

  // Script without iframe, wrapper without either, or a stale stylesUri → tear down and inject fresh.
  if (rcAdapterPresent()) teardownAdapter();
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
 * RingCentral Embeddable bootstrap — mounts only on Sales + Customer Service + Collection routes.
 * Lives in WorkerLayout so switching between those Mytrions does not remount the softphone.
 */
export function RingCentralPhone() {
  const { pathname } = useLocation();
  const allowed = isRingCentralRoute(pathname);

  const [toasts, setToasts] = useState<ToastMsg[]>([]);
  /**
   * Whether to show the "phone not signed in" prompt.
   *
   * This exists because the softphone boots MINIMISED to a small vendor pill, and until now nothing
   * in our own UI ever surfaced the signed-out state — `ringCentralLoginState()` was read by nobody.
   * An agent who did not know to click that pill simply never saw a sign-in screen, which is exactly
   * the "RingCentral doesn't show the sign in page" report. Every feature tied to the phone (Data
   * Center Leads/Deals, Retention calls) silently does nothing in that state, so it has to be loud.
   */
  const [showSignIn, setShowSignIn] = useState(false);
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
      // The component lives in WorkerLayout, so it renders on every worker route — only the WIDGET is
      // route-gated. Without this the card followed the agent onto Billing / Finance / Admin / the
      // picker, prompting them to sign into a softphone that is not even mounted there.
      setShowSignIn(false);
      // A pending toast (e.g. "session ended") must not survive onto a Mytrion the widget isn't even
      // mounted on — it would sit there, unexplained, for the rest of its 8s lifetime.
      setToasts([]);

      /**
       * Guard against a LATE-ARRIVING vendor iframe.
       *
       * `teardownAdapter()` only removes what's in the DOM right now. If the vendor's Embeddable script
       * was still mid-boot when the agent navigated away — it was fetched and is executing independently
       * of this component, and `cancelled` (below, in the allowed branch) only stops OUR code, never the
       * vendor's already-running one — it can finish and insert `#rc-widget-adapter-frame` a moment
       * later, onto whatever page is showing by then. Nothing was watching for that, which is exactly how
       * the softphone leaked onto HR after being opened in Sales and left mid-boot: teardown ran before
       * the frame existed, found nothing to remove, and the frame arrived afterward with no one left to
       * catch it. This observer stays armed for as long as we're on a disallowed Mytrion and removes any
       * adapter script/frame the instant it appears.
       */
      const guard = new MutationObserver(() => {
        if (rcAdapterPresent()) teardownAdapter();
      });
      guard.observe(document.body, { childList: true, subtree: true });
      return () => guard.disconnect();
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

    /**
     * Continuous, not one-shot.
     *
     * The old check sampled the login state ONCE, 7s after mount, and treated "unknown" as
     * signed-out — but the adapter alone is allowed 12s to produce its iframe (FRAME_WAIT_MS), and a
     * route hop wipes the cached state, so a slow boot showed "Phone not signed in" to an agent who
     * was signed in the whole time and nothing ever re-checked it. Now only a state that is KNOWN
     * false and STAYS false prompts, and the card retracts itself as soon as the widget reports a
     * session.
     */
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
      // Event-first, with one bounded confirmation timer. The old 1.5s interval ran for the
      // lifetime of every Sales/CS/Collection page even while the phone was healthy.
      if (!next.show && ringCentralLoginState() !== true) {
        signInTimer = window.setTimeout(evaluateSignIn, SIGNED_OUT_CONFIRM_MS);
      }
    };
    evaluateSignIn();

    const unsubscribe = subscribeRingCentral((event: RingCentralCallEvent) => {
      if (cancelled) return;
      if (event.kind === 'login') {
        signedOutSince = null;
        // A fresh session re-arms the prompt for a future genuine logout.
        signInCardMuted = false;
        setShowSignIn(false);
        clearSignInTimer();
        // Don't pop the widget open on login — leave it docked; the agent opens it when they want.
        clearPendingLogoutToast();
        return;
      }
      if (event.kind !== 'logout') return;
      signedOutSince = Date.now();
      evaluateSignIn();
      // Deliberately does NOT show the card: Embeddable flaps logged-out during session restore
      // (exactly why the toast below is debounced), and reacting to the raw event is what put
      // "Phone not signed in" in front of signed-in agents. evaluateSignIn() prompts if it holds.
      clearPendingLogoutToast();
      pendingLogoutToast = setTimeout(() => {
        pendingLogoutToast = null;
        if (cancelled) return;
        // The flap resolved and the session is back — there is nothing to report.
        if (ringCentralLoginState() === true) return;
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
    // Host CSS keeps the cursor correct. Observe only frame insertion; never observe every style
    // mutation in the whole document and never run a permanent 800ms polling loop.
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
      }
    });
    cursorObs.observe(document.body, {
      childList: true,
      subtree: true,
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
      clearSignInTimer();
      clearPendingLogoutToast();
      unsubscribe();
      cursorObs.disconnect();
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pageshow', onPageShow);
      // Softphone stays mounted while hopping between Sales / CS / Collection (allowed stays true).
    };
  }, [allowed]);

  // Full unmount (logout / leave worker portal) always tears down the vendor iframe.
  useEffect(() => () => teardownAdapter(), []);

  // Nothing of ours renders off a desk-phone Mytrion. Already true via the effect above (which clears
  // both pieces of state), but stating it makes the launcher case a guarantee rather than an inference.
  if (!allowed) return null;

  // The host stack exists only for actionable UI. The vendor's own dock remains mounted separately.
  if (toasts.length === 0 && !showSignIn) return null;

  return (
    <div
      className="rc-phone-stack"
      /*
       * Right edge, not left: bottom-left sat on top of the Mytrion sidebar's footer (the "View as"
       * button and the user card) and the first column of every wide table.
       *
       * `bottom: 96px` clears the 56px Copilot FAB that CS docks at bottom-right, and the vendor
       * RingCentral pill, which also docks bottom-right.
       *
       * z-index sits BELOW the modal layer (CS backdrops are 9990/9995) so an open dialog paints
       * over the card instead of the card burying that dialog's footer buttons — at 999999 it did
       * exactly that. It stays above the Copilot FAB/panel (90/95); the panel is the one surface it
       * can still overlap, which is what the dismiss control below is for.
       */
      style={{
        position: 'fixed',
        // Clears the CS Copilot FAB, and below the structure line the tab bar and home
        // indicator too. This component mounts in WorkerLayout, outside the shell, which is
        // why --layout-bottom-inset lives on :root.
        bottom: 'calc(96px + var(--layout-bottom-inset, 0px))',
        right: '24px',
        zIndex: 200,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        gap: '10px',
      }}
    >
      {showSignIn && (
        /* Persistent on purpose — not a toast. Every phone-backed feature is inert until the agent
           signs in, so this stays put until they do. Clicking EXPANDS the vendor widget, which is the
           only place the RingCentral login screen can render. */
        <div
          role="status"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            padding: '12px 14px',
            minWidth: '280px',
            maxWidth: '340px',
            borderRadius: 'var(--radius-md, 12px)',
            background: 'var(--hz-modal-surface, var(--surface))',
            border: '1px solid var(--intent-warning-bd)',
            borderLeft: '4px solid var(--warning)',
            boxShadow: 'var(--hz-shadow-pop)',
            color: 'var(--text-primary)',
          }}
        >
          <Phone size={18} color="var(--warning)" />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '3px' }}>
            <div style={{ fontWeight: 600, fontSize: '14px' }}>Phone not signed in</div>
            <div style={{ fontSize: '12.5px', color: 'var(--text-muted)', lineHeight: 1.45 }}>
              Calling, call logging and the post-call wizard stay off until you sign in.
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              revealRingCentralWidget();
              // Mute until the widget actually reports a session. Without this the poll — which
              // already holds a confirmed signed-out state — puts the card straight back a second
              // after the click, on top of the login screen it just opened.
              signInCardMuted = true;
              setShowSignIn(false);
            }}
            style={{
              flexShrink: 0,
              height: '32px',
              padding: '0 14px',
              borderRadius: 'var(--radius-md, 10px)',
              border: 'none',
              background: 'var(--accent)',
              color: '#fff',
              fontWeight: 700,
              fontSize: '13px',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Sign in
          </button>
          {/* Persistent, but not immovable: the card shares the bottom-right corner with the CS
              Copilot panel, so an agent who isn't using the phone can get it out of the way. */}
          <button
            type="button"
            onClick={() => {
              // Sticks for the rest of the session (cleared on the next sign-in) — closing it used
              // to last only until the next route hop.
              signInCardMuted = true;
              setShowSignIn(false);
            }}
            aria-label="Dismiss"
            title="Dismiss"
            style={{
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              background: 'transparent',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              padding: '2px',
            }}
          >
            <X size={15} />
          </button>
        </div>
      )}
      {toasts.map((t) => (
        <div
          key={t.id}
          style={{
            background: 'var(--surface)',
            borderLeft: '4px solid var(--danger)',
            padding: '12px 16px',
            borderRadius: '6px',
            boxShadow: 'var(--hz-shadow-lift)',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '12px',
            minWidth: '280px',
            color: 'var(--text-primary)',
          }}
        >
          <AlertCircle size={20} color="var(--danger)" />

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div style={{ fontWeight: 600, fontSize: '14px' }}>{t.title}</div>
            <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{t.message}</div>
          </div>

          <button
            type="button"
            onClick={() => removeToast(t.id)}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-muted)',
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
