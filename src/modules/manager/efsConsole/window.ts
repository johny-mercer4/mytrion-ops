/**
 * Date-window rules for the EFS Console.
 *
 * EFS enforces two different ceilings and it does NOT clamp — a wider range comes back as a 400,
 * or worse as an ADBException from deep inside the SOAP stack. So the rule is checked here, before
 * the call, and the same numbers are published to the UI through `/v1/manager/efs/capabilities`
 * so the date picker can refuse an over-wide range at selection time instead of the operator
 * discovering it as a failed request several seconds later.
 *
 * Timestamps are ISO-8601 with an offset, which is what the console fetchers take (unlike
 * `/api/efs/touchpoints/*`, which takes yyyy-mm-dd — see modules/finance/financeEfs.ts).
 */
import { ValidationError } from '../../../lib/errors.js';
import { EFS_WINDOW_MAX_DAYS, type EfsWindowRule } from './types.js';

const DAY_MS = 86_400_000;

export interface EfsResolvedWindow {
  from: string;
  to: string;
  days: number;
}

/** Default span per rule when the caller gives no dates — comfortably inside every ceiling. */
const DEFAULT_DAYS: Record<EfsWindowRule, number> = { none: 0, txn7d: 7, history90d: 30 };

/**
 * Resolve and validate a window for one fetcher.
 *
 * Returns null for `window: 'none'` endpoints — they take no dates and passing some would be
 * silently ignored upstream, which is exactly the class of bug the `.strict()` query schemas in
 * finance.routes.ts exist to prevent.
 */
export function resolveEfsWindow(
  rule: EfsWindowRule,
  input: { from?: string | undefined; to?: string | undefined },
): EfsResolvedWindow | null {
  if (rule === 'none') return null;

  const max = EFS_WINDOW_MAX_DAYS[rule];
  const hasFrom = Boolean(input.from);
  const hasTo = Boolean(input.to);
  if (hasFrom !== hasTo) {
    throw new ValidationError('from and to must be given together');
  }

  const now = Date.now();
  if (!hasFrom) {
    const days = DEFAULT_DAYS[rule];
    return { from: new Date(now - days * DAY_MS).toISOString(), to: new Date(now).toISOString(), days };
  }

  const fromMs = Date.parse(input.from as string);
  const toMs = Date.parse(input.to as string);
  if (Number.isNaN(fromMs)) throw new ValidationError(`from is not a valid date: ${String(input.from)}`);
  if (Number.isNaN(toMs)) throw new ValidationError(`to is not a valid date: ${String(input.to)}`);
  if (toMs < fromMs) throw new ValidationError('to must not be earlier than from');

  // Ceil, not round: a 7-day window is 7 × 24h, and a range one second over must fail here rather
  // than at EFS. Being strict on our side is the whole point of publishing the limit.
  const days = Math.ceil((toMs - fromMs) / DAY_MS);
  if (max !== null && days > max) {
    throw new ValidationError(
      `EFS caps this range at ${max} days; you asked for ${days}. Narrow the window and try again.`,
    );
  }

  return { from: new Date(fromMs).toISOString(), to: new Date(toMs).toISOString(), days };
}
