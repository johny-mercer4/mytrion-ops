/**
 * Outstanding days on a CMP invoice, and the 30-day paid-late summary.
 *
 *   outstanding days = paid date - (invoice created date + 1)
 *
 * Its own module rather than more lines in `DataCenter.tsx`, which is already past the 600-line cap
 * in CLAUDE.md — and because this is business arithmetic with a unit test beside it, not view code.
 *
 * Self-contained field reading on purpose: `DataCenter.tsx` has its own `pick`/`str`, but importing
 * them would make a leaf arithmetic module depend on the 700-line panel that renders it. Six lines of
 * duplication buys a module that can be tested and reused without pulling a component graph in.
 */

const str = (v: unknown): string => (v == null ? '' : String(v));

/** First present key wins, so both camelCase and snake_case CMP payloads read. */
function pick(o: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const k of keys) if (o[k] != null && o[k] !== '') return o[k];
  return undefined;
}

const CREATED_KEYS = ['createdDate', 'created_date', 'createDate'] as const;
const PAID_KEYS = ['paymentDate', 'payment_date'] as const;

export const DAY_MS = 86_400_000;

/**
 * A CMP date string -> UTC midnight, or null.
 *
 * `paymentDate` arrives normalised as `YYYY-MM-DD` (servercrm's billingCmpRoutes.js slices an ISO
 * string), but `createdDate` is CMP's `createDate` passed through raw and trimmed, so it may carry a
 * time. Slicing to the first 10 chars normalises both and keeps the arithmetic on whole days, which
 * is the unit the formula is stated in. The explicit `Z` is what makes it UTC rather than the host's
 * timezone — otherwise the same invoice could read differently for two agents.
 */
export function ymdUtc(v: unknown): Date | null {
  const s = str(v).trim();
  if (!s) return null;
  const d = new Date(`${s.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Days an invoice sat unpaid: `paid date - (created date + 1)`.
 *
 * The `+1` is the grace day the business counts — an invoice paid the day after it is raised is not
 * outstanding.
 *
 * Returns null when either date is missing, which is the entire population of UNPAID invoices: they
 * have no payment date, and the formula has no meaning without one. Null rather than 0 is load
 * bearing — a 0 in that slot would read as "paid on time".
 *
 * Clamped at 0, because CMP can stamp a payment on the day it raises the invoice, which makes the
 * raw difference -1.
 */
export function outstandingDays(invoice: Record<string, unknown>): number | null {
  const created = ymdUtc(pick(invoice, CREATED_KEYS));
  const paid = ymdUtc(pick(invoice, PAID_KEYS));
  if (!created || !paid) return null;
  return Math.max(0, Math.round((paid.getTime() - created.getTime()) / DAY_MS) - 1);
}

/**
 * How many of the last 30 days' invoices were paid late, over how many could be judged.
 *
 * `total` counts only invoices with a resolvable figure — i.e. paid ones. Unpaid invoices are
 * excluded from BOTH halves deliberately: folding them into the denominator would mix two
 * populations and drag the ratio down every time a new invoice is raised, which is backwards for a
 * lateness measure.
 *
 * The window is on the invoice's CREATED date, not its payment date, so the set being judged does not
 * shift when an old invoice is finally paid.
 */
export function outstandingLast30(
  invoices: ReadonlyArray<Record<string, unknown>>,
): { late: number; total: number } {
  const cutoff = Date.now() - 30 * DAY_MS;
  let late = 0;
  let total = 0;
  for (const invoice of invoices) {
    const created = ymdUtc(pick(invoice, CREATED_KEYS));
    if (!created || created.getTime() < cutoff) continue;
    const days = outstandingDays(invoice);
    if (days == null) continue;
    total += 1;
    if (days > 0) late += 1;
  }
  return { late, total };
}
