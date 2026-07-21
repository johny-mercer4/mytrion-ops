/**
 * Console noise filter for the RingCentral Embeddable adapter — a vendor bundle loaded from
 * apps.ringcentral.com that we cannot patch, and whose released build logs every widget event
 * (`rc-*-notify`) plus its extension/subscription internals to the page console. No adapter
 * query param silences these (enableErrorReport=false only governs error reporting).
 *
 * Wraps console.log/debug/info with a first-argument predicate; warn/error are NEVER touched,
 * and no app log uses these prefixes, so our own output is never swallowed.
 *
 * NOTE: lines logged INSIDE the widget iframe (e.g. krispsdk) run in a cross-origin context
 * and cannot be filtered from this page — DevTools still shows them unless "Selected context
 * only" is enabled. That residue is expected, not a bug.
 */

const RC_NOISE: RegExp[] = [
  // Adapter event echoes: 'rc-login-status-notify:', 'rc-webphone-connection-status-notify:', …
  /^rc-[a-z0-9-]+-notify:?$/i,
  /^\[RingCentralExtensions\]/,
  /^\[WebSocketSubscription\]/,
  /^\[WebSocketExtension\]/,
];

function isRcNoise(args: unknown[]): boolean {
  const first = args[0];
  return typeof first === 'string' && RC_NOISE.some((re) => re.test(first.trim()));
}

const MARKER = '__mytrionRcConsoleFilter';

/** Install once (idempotent across remounts AND HMR via a console-object marker). */
export function installRcConsoleFilter(): void {
  const c = console as Console & { [MARKER]?: true };
  if (c[MARKER]) return;
  c[MARKER] = true;
  for (const level of ['log', 'debug', 'info'] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]): void => {
      if (isRcNoise(args)) return;
      original(...args);
    };
  }
}
