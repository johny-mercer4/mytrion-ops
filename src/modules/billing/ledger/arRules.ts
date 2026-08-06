/**
 * The shared AR predicates — EXTRACTED from ../../analytics/dimensions/receivables.ts so the Billing
 * Ledger's AR sub-ledger and the Receivables analytics report cannot drift apart on what "owed" means.
 *
 * These are SQL fragments, not values: they assume `public.cmp_invoice` is aliased `i` and
 * `public.cmp_invoice_payment` is aliased `p`, which is how every caller writes its FROM clause.
 *
 * They were previously inlined in receivables.ts. `receivables.ts` now imports them, and
 * `tests/unit/ledger-aging.test.ts` asserts the strings are character-identical to what it used to
 * inline — a drift guard in the same spirit as the index-predicate assertion in
 * `tests/unit/cs-maintenance-repo.test.ts`. Changing one of these changes two reports; do it on purpose.
 */

/** Still-owed balance on an invoice, floored at zero (overpayments must not net off other rows). */
export const DUE = 'greatest(i.total_amount - coalesce(i.total_paid, 0), 0)';

/** The open-AR book — same rule as dwhClientRoster's debt_cte. */
export const OPEN_INVOICE = `i.status in ('PENDING', 'PARTIALLY_PAID') and ${DUE} >= 1`;

export const INVOICE_DATE = 'i.invoice_date';
export const PAYMENT_DATE = 'p.payment_date';

/** Reversed/bounced payments are not collections. */
export const PAYMENT_OK = 'coalesce(p.is_failed, false) = false';

/**
 * Days past due for an invoice. Null `due_date` yields null rather than 0 — an invoice with no due date
 * is a data-quality problem, and calling it "0 days overdue" hides it inside the Current bucket.
 */
export const DAYS_PAST_DUE = '(current_date - i.due_date::date)';

/** One aging bucket: a key, its label, and the SQL condition that selects it. */
export interface AgingBucketDef {
  key: string;
  label: string;
  /** SQL predicate over `i`. */
  when: string;
  tone: 'good' | 'warn' | 'danger' | 'muted';
}

/**
 * The TZ §9 buckets — 0–7 / 8–14 / 15–30 / 30+ — PLUS two the TZ does not name but the data requires:
 *
 *   • `current` ("Not yet due"). The TZ's set has nowhere for an invoice that simply is not due yet.
 *     Folding those into `0–7` would make that bucket mean "either a week overdue or three weeks
 *     early", which is worse than useless on a collections screen.
 *   • `no_due_date`. receivables.ts lumps a null `due_date` into Current; for a control point that
 *     hides a genuinely broken invoice, so it gets its own bucket and is surfaced as a data-quality
 *     count rather than silently absorbed.
 *
 * Six buckets, not four — flagged for billing's confirmation in the plan's open questions.
 */
export const LEDGER_AGING_BUCKETS: readonly AgingBucketDef[] = [
  {
    key: 'no_due_date',
    label: 'No due date',
    when: 'i.due_date is null',
    tone: 'muted',
  },
  {
    key: 'current',
    label: 'Not yet due',
    when: `i.due_date is not null and ${DAYS_PAST_DUE} <= 0`,
    tone: 'good',
  },
  {
    key: 'd0_7',
    label: '0–7 days',
    when: `i.due_date is not null and ${DAYS_PAST_DUE} between 1 and 7`,
    tone: 'good',
  },
  {
    key: 'd8_14',
    label: '8–14 days',
    when: `i.due_date is not null and ${DAYS_PAST_DUE} between 8 and 14`,
    tone: 'warn',
  },
  {
    key: 'd15_30',
    label: '15–30 days',
    when: `i.due_date is not null and ${DAYS_PAST_DUE} between 15 and 30`,
    tone: 'danger',
  },
  {
    key: 'd30_plus',
    label: '30+ days',
    when: `i.due_date is not null and ${DAYS_PAST_DUE} > 30`,
    tone: 'danger',
  },
];

/**
 * The bucket set receivables.ts has shipped since before the ledger existed: Current / 1-7 / 8-30 /
 * 31-60 / 60+, with a null `due_date` folded into Current. Kept EXACTLY as it was — its output is
 * asserted byte-identical by the drift test, because changing a shipped report's buckets is a separate,
 * deliberate decision from adding the ledger's.
 */
export const RECEIVABLES_AGING_BUCKETS: readonly AgingBucketDef[] = [
  {
    key: 'Current',
    label: 'Current',
    when: 'i.due_date is null or i.due_date::date >= current_date',
    tone: 'good',
  },
  { key: '1-7 days', label: '1-7 days', when: `${DAYS_PAST_DUE} between 1 and 7`, tone: 'good' },
  { key: '8-30 days', label: '8-30 days', when: `${DAYS_PAST_DUE} between 8 and 30`, tone: 'warn' },
  { key: '31-60 days', label: '31-60 days', when: `${DAYS_PAST_DUE} between 31 and 60`, tone: 'danger' },
  { key: '60+ days', label: '60+ days', when: `${DAYS_PAST_DUE} > 60`, tone: 'danger' },
];

/**
 * Render a bucket set as a `CASE` expression. Buckets are evaluated in order, so the first matching
 * `when` wins — which is why `no_due_date` is listed first in the ledger set.
 */
export function agingBucketSql(buckets: readonly AgingBucketDef[]): string {
  const arms = buckets.map((b) => `    when ${b.when} then '${b.key}'`).join('\n');
  return `case\n${arms}\n    else '${buckets[buckets.length - 1]?.key ?? 'unknown'}'\n  end`;
}

/** `ORDER BY` expression that puts buckets in declaration order rather than alphabetically. */
export function agingOrderSql(buckets: readonly AgingBucketDef[]): string {
  const arms = buckets.map((b, i) => `    when '${b.key}' then ${i}`).join('\n');
  return `case bucket\n${arms}\n    else ${buckets.length}\n  end`;
}
