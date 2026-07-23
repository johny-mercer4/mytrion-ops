/**
 * Console noise filter for the RingCentral Embeddable adapter — a vendor bundle loaded from
 * apps.ringcentral.com that we cannot patch. Its released build logs every widget event
 * (`rc-*-notify`) plus extension/subscription internals, and it probes the platform API
 * before OAuth completes, which surfaces AGW-401 ("Authorization header is not specified")
 * as console noise. No adapter query param silences these (enableErrorReport=false only
 * governs RC's own error reporting channel).
 *
 * Wraps console.log/debug/info/warn/error with a first-argument predicate. Only known RC
 * noise is dropped — app logs never use these prefixes/codes.
 *
 * NOTE: lines logged INSIDE the widget iframe (e.g. krispsdk) run in a cross-origin context
 * and cannot be filtered from this page — DevTools still shows them unless "Selected context
 * only" is enabled. Network-tab 401 rows also cannot be hidden from here.
 */

const RC_NOISE: RegExp[] = [
  // Adapter event echoes: 'rc-login-status-notify:', 'rc-webphone-connection-status-notify:', …
  // (no trailing $ — vendor often appends status args on the same call)
  /^rc-[a-z0-9-]+-notify:?/i,
  /^\[RingCentralExtensions\]/,
  /^\[WebSocketSubscription\]/,
  /^\[WebSocketExtension\]/,
  // SIP.js ringtone/remote media — browser autoplay blocks until a user gesture unlocks audio.
  /sip\.inviteclientcontext/i,
  /play was rejected/i,
  // Pre-login / expired-session platform probes (vendor Embeddable → platform.ringcentral.com).
  /\bAGW-401\b/,
  /Authorization header is not specified/i,
];

/** Flatten console args so object payloads (`{ errorCode: 'AGW-401', … }`) are matchable. */
function flattenArg(a: unknown): string {
  if (typeof a === 'string') return a;
  if (a instanceof Error) return a.message;
  if (a && typeof a === 'object') {
    const o = a as Record<string, unknown>;
    if (typeof o.errorCode === 'string' && o.errorCode.startsWith('AGW-')) {
      const msg = typeof o.message === 'string' ? o.message : '';
      return `${o.errorCode} ${msg}`;
    }
    if (Array.isArray(o.errors)) {
      return o.errors.map(flattenArg).join(' ');
    }
    try {
      return JSON.stringify(a);
    } catch {
      return '';
    }
  }
  return '';
}

function isRcNoise(args: unknown[]): boolean {
  const joined = args.map(flattenArg).join(' ');
  return RC_NOISE.some((re) => re.test(joined));
}

const MARKER = '__mytrionRcConsoleFilter';

/** Install once (idempotent across remounts AND HMR via a console-object marker). */
export function installRcConsoleFilter(): void {
  const c = console as Console & { [MARKER]?: true };
  if (c[MARKER]) return;
  c[MARKER] = true;
  for (const level of ['log', 'debug', 'info', 'warn', 'error'] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]): void => {
      if (isRcNoise(args)) return;
      original(...args);
    };
  }
}
