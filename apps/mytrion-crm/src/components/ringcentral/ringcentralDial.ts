/**
 * Click-to-dial helpers for RingCentral Embeddable (postMessage / RCAdapter).
 * Docs: https://ringcentral.github.io/ringcentral-embeddable/docs/integration/api/
 */

declare global {
  interface Window {
    RCAdapter?: {
      clickToCall?: (phoneNumber: string, toCall?: boolean) => void;
      setMinimized?: (minimized: boolean) => void;
      setClosed?: (closed: boolean) => void;
      /** Vendor teardown. Removes the container and its mousemove/resize listeners. */
      dispose?: () => void;
    };
    /**
     * The vendor's own supported teardown: `if (!window.RCAdapter) return; RCAdapter.dispose();
     * RCAdapter = null;`. It short-circuits on a missing global, so it MUST be called before the
     * handle is dropped.
     */
    RCAdapterDispose?: () => void;
  }
}

const SCRIPT_ID = 'mytrion-rc-embeddable-adapter';

/** Digits / + only — Embeddable accepts formatted numbers but bare E.164 is most reliable. */
export function normalizeDialNumber(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return '';
  return hasPlus ? `+${digits}` : digits;
}

/** True when the Embeddable iframe is in the DOM (script alone is not enough). */
export function isRingCentralReady(): boolean {
  return Boolean(document.querySelector('#rc-widget-adapter-frame'));
}

/** Bring the docked softphone forward (expanded) — for an explicit user action like click-to-dial. */
export function revealRingCentralWidget(): void {
  try {
    window.RCAdapter?.setClosed?.(false);
    window.RCAdapter?.setMinimized?.(false);
  } catch {
    /* vendor API optional */
  }
}

/**
 * Ensure the softphone is present as a MINIMIZED dock — visible/reachable but NOT popped open. Used
 * for automatic lifecycle nudges (mount / iframe re-appear) so the widget is available without
 * suddenly expanding. Only an explicit user action (click-to-dial, or clicking the dock itself)
 * should expand it via revealRingCentralWidget.
 */
export function dockRingCentralWidget(): void {
  try {
    window.RCAdapter?.setClosed?.(false);
    window.RCAdapter?.setMinimized?.(true);
  } catch {
    /* vendor API optional */
  }
}

/**
 * Place (or stage) a call in the Embeddable widget. Returns false if the widget isn't loaded yet.
 */
export function clickToDial(phone: string, toCall = true): boolean {
  const phoneNumber = normalizeDialNumber(phone);
  if (!phoneNumber) return false;

  /**
   * The iframe is the truth, not the global.
   *
   * `window.RCAdapter` is installed by the vendor script and can outlive the widget — a persisted
   * session probe restores it before the iframe exists, and teardown could not reach it at all until
   * it started deleting it. Checking `clickToCall` first therefore let this call `revealRingCentralWidget()`
   * on a torn-down widget: the softphone "popped open" on a Mytrion it was not mounted on and the
   * call went nowhere. Both branches below already required the frame, so this early return costs no
   * working call path.
   */
  if (!isRingCentralReady()) return false;

  if (typeof window.RCAdapter?.clickToCall === 'function') {
    revealRingCentralWidget();
    window.RCAdapter.clickToCall(phoneNumber, toCall);
    return true;
  }

  const frame = document.querySelector('#rc-widget-adapter-frame') as HTMLIFrameElement | null;
  if (!frame?.contentWindow) return false;
  // Post to the widget's real origin (derived from its own src) so the dialed number can't leak to
  // an unexpected document. Falls back to '*' only if the src can't be parsed — never blocks dialing.
  let targetOrigin = '*';
  try {
    const origin = new URL(frame.src).origin;
    if (origin && origin !== 'null') targetOrigin = origin;
  } catch {
    /* keep '*' */
  }
  frame.contentWindow.postMessage(
    { type: 'rc-adapter-new-call', phoneNumber, toCall },
    targetOrigin,
  );
  return true;
}

export { SCRIPT_ID as RC_ADAPTER_SCRIPT_ID };
