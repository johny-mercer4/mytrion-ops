/**
 * Click-to-dial helpers for RingCentral Embeddable (postMessage / RCAdapter).
 * Docs: https://ringcentral.github.io/ringcentral-embeddable/docs/integration/api/
 */

declare global {
  interface Window {
    RCAdapter?: {
      clickToCall?: (phoneNumber: string, toCall?: boolean) => void;
      setMinimized?: (minimized: boolean) => void;
    };
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

export function isRingCentralReady(): boolean {
  return Boolean(
    document.getElementById(SCRIPT_ID) || document.querySelector('#rc-widget-adapter-frame'),
  );
}

/**
 * Place (or stage) a call in the Embeddable widget. Returns false if the widget isn't loaded yet.
 */
export function clickToDial(phone: string, toCall = true): boolean {
  const phoneNumber = normalizeDialNumber(phone);
  if (!phoneNumber) return false;

  if (typeof window.RCAdapter?.clickToCall === 'function') {
    window.RCAdapter.setMinimized?.(false);
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
