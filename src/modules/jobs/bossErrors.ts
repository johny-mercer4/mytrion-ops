/**
 * How loudly to report a pg-boss `error` event.
 *
 * pg-boss v12 runs several independent internal loops (queue-cache refresh, supervision, the cron
 * timekeeper, the job navigator, maintenance) plus one poller per registered queue, and each one
 * surfaces its own failure. So a single two-second gap in the database link — a resumed laptop, a
 * Wi-Fi change, a reaped idle socket — produced five identical `ERROR: pg-boss error` entries with
 * full stack traces in the same millisecond, none of which pointed at anything wrong in this service.
 *
 * The stacks were noise too: they end in pg-boss's own poll loop, never at a cause.
 *
 * Kept separate from boss.ts, and pure, so the classification is testable without booting pg-boss.
 */

/** Recoverable link failures: the pool retries on its own and jobs are not lost. */
const TRANSIENT_DB_ERROR_PATTERNS = [
  'timeout exceeded when trying to connect',
  'connection terminated',
  'connection ended unexpectedly',
  'econnreset',
  'econnrefused',
  'etimedout',
  'epipe',
  'enotfound',
  'eai_again',
  'socket hang up',
  'terminating connection due to administrator command',
];

/** pg-boss emits plain objects as well as Errors, so read the message defensively. */
function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object' && 'message' in err) return String((err as { message: unknown }).message);
  return String(err);
}

export function isTransientDbError(err: unknown): boolean {
  const message = messageOf(err).toLowerCase();
  return TRANSIENT_DB_ERROR_PATTERNS.some((pattern) => message.includes(pattern));
}

/** Rolling count of transient errors, so a burst collapses into one line instead of dozens. */
export interface TransientWindow {
  startedAt: number;
  count: number;
}

export const EMPTY_TRANSIENT_WINDOW: TransientWindow = { startedAt: 0, count: 0 };

export type BossErrorAction =
  /** A genuine fault — log at error level, with the stack. */
  | { kind: 'error' }
  /** First transient error of a window, or a periodic reminder that the link is still down. */
  | { kind: 'warn'; message: string; occurrences: number }
  /** Burst continuation — already reported, say nothing. */
  | { kind: 'suppress' };

export interface BossErrorClassification {
  action: BossErrorAction;
  window: TransientWindow;
}

/** Log one reminder per this many suppressed errors, so an outage that persists stays visible. */
const REMINDER_EVERY = 25;

export function classifyBossError(
  err: unknown,
  now: number,
  window: TransientWindow,
  windowMs: number,
): BossErrorClassification {
  if (!isTransientDbError(err)) return { action: { kind: 'error' }, window };

  const message = messageOf(err);
  // A quiet spell means the link recovered; the next failure is news again.
  if (now - window.startedAt > windowMs) {
    return { action: { kind: 'warn', message, occurrences: 1 }, window: { startedAt: now, count: 1 } };
  }

  const count = window.count + 1;
  const next = { startedAt: window.startedAt, count };
  if (count % REMINDER_EVERY === 0) {
    return { action: { kind: 'warn', message, occurrences: count }, window: next };
  }
  return { action: { kind: 'suppress' }, window: next };
}
