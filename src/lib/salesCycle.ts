/**
 * The Octane sales cycle: the **26th of one month through the 25th of the next**.
 *
 * This is the period reps are measured on and the period their dashboard renders, so it is the
 * period they mean by "this month". It was previously restated in three places
 * (`manager/salesKpiBoard.ts`, and twice in `integrations/dwhClientRoster.ts`) plus a fourth
 * TypeScript copy in the CRM frontend. Four copies of one business rule is three chances for them
 * to drift, so the SQL form is stated once here and imported.
 *
 * TIMEZONE, stated because it bites: the SQL below resolves against the DATABASE server's
 * `current_date` — the DWH pool sets no TimeZone — while the frontend's copy uses the browser's
 * local date. Near midnight, or for a user in another timezone, the two can name different cycles
 * for a few hours around the 25th/26th. Neither is wrong; they answer different questions.
 */

/**
 * SQL expression yielding the current cycle's START (the 26th), as a timestamp.
 *
 * `date_trunc('month', …)` gives the 1st, so `+ interval '25 days'` is the 26th.
 */
export const CYCLE_START_SQL = `case when extract(day from current_date) >= 26
                   then date_trunc('month', current_date) + interval '25 days'
                   else date_trunc('month', current_date) - interval '1 month' + interval '25 days'
              end`;

/** The PREVIOUS cycle's start — one month before the current one. Nothing computed this before. */
export const PREV_CYCLE_START_SQL = `(${CYCLE_START_SQL} - interval '1 month')`;

/**
 * A named CTE exposing `cycle_start`. Use in a `with` clause:
 *   `with ${cycleCte()}, other as (...)`
 */
export function cycleCte(name = 'cyc'): string {
  return `${name} as (
    select ${CYCLE_START_SQL} as cycle_start
  )`;
}

/**
 * A WHERE fragment bounding `column` to the current or previous cycle.
 *
 * Half-open by design: `>= start` and `< start + 1 month`. Because the start is the 26th, the
 * exclusive upper bound lands on the next 26th, which makes the 25th the last included day —
 * inclusive of the whole 25th, without any date arithmetic on month lengths.
 */
export function cycleWindowSql(column: string, which: 'current' | 'previous'): string {
  const start = which === 'current' ? `(${CYCLE_START_SQL})` : PREV_CYCLE_START_SQL;
  return `${column} >= ${start} and ${column} < ${start} + interval '1 month'`;
}

export interface SalesCycleBounds {
  /** Inclusive start — the 26th. */
  start: Date;
  /** EXCLUSIVE end — the following 26th. The last included day is the 25th. */
  endExclusive: Date;
  /** Inclusive last day (the 25th), for display. */
  endInclusive: Date;
  /** e.g. "26 Jul – 25 Aug 2026". */
  label: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * The cycle containing `today`, in UTC.
 *
 * UTC rather than local time so a server-side computation is deterministic and matches how the
 * warehouse stores dates. `offset` shifts whole cycles back: 0 = current, 1 = previous.
 */
export function salesCycleBounds(today: Date, offset = 0): SalesCycleBounds {
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth();
  // Day >= 26 → the cycle started on the 26th of THIS month; otherwise the 26th of last month.
  const startMonthOffset = (today.getUTCDate() >= 26 ? 0 : -1) - offset;
  const start = new Date(Date.UTC(y, m + startMonthOffset, 26));
  const endExclusive = new Date(Date.UTC(y, m + startMonthOffset + 1, 26));
  const endInclusive = new Date(endExclusive.getTime() - 86_400_000);
  const label =
    `${start.getUTCDate()} ${MONTHS[start.getUTCMonth()]} – ` +
    `${endInclusive.getUTCDate()} ${MONTHS[endInclusive.getUTCMonth()]} ${endInclusive.getUTCFullYear()}`;
  return { start, endExclusive, endInclusive, label };
}

/** ISO `YYYY-MM-DD` for a cycle boundary, for tools that take explicit from/to strings. */
export function cycleRangeIso(today: Date, offset = 0): { from: string; to: string } {
  const b = salesCycleBounds(today, offset);
  return {
    from: b.start.toISOString().slice(0, 10),
    to: b.endInclusive.toISOString().slice(0, 10),
  };
}
