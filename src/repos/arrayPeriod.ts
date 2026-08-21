/**
 * Ordering Array filings by the month they cover.
 *
 * `array_reports.report_period` is written by servercrm's AR-SYNC as
 * `today.toLocaleString('en-US', { month: 'short', year: 'numeric' })` — a HUMAN string,
 * `'Aug 2026'`, not `'2026-08'`. Sorted as text it is nonsense: descending gives
 * May > Jun > Jul > Aug, so "newest filing" came back as the OLDEST one. Measured on production
 * before this existed, the `DISTINCT ON (carrier_id) … ORDER BY report_period DESC` in the
 * placement queue and the worklist picked May 2026 for 1,960 of 2,469 carriers — a snapshot three
 * months stale — and only reached August for the 12 carriers that had no earlier filing.
 *
 * Rather than rewrite the stored values (the next AR-SYNC tick would put them straight back), sort
 * on a derived key. `'Aug 2026'` → `'2026-08'`, which sorts correctly as text.
 *
 * The month lookup is a substring position rather than `to_date(…, 'Mon YYYY')` on purpose:
 * `to_date` RAISES on a value it cannot parse, and one malformed row would take down every list
 * on the desk. This returns `'0000-00'` for anything unrecognised, which sorts last and is
 * visible in the data if it ever happens. Values already in `YYYY-MM` (test fixtures, local
 * seeds) pass through untouched.
 */
import { sql, type SQL } from 'drizzle-orm';
import { arrayReports } from '../db/schema/collection.js';

/** `'Aug 2026'` → `'2026-08'`. A SQL expression, safe to use in ORDER BY and DISTINCT ON. */
export const reportPeriodSortKey: SQL<string> = sql<string>`
  case
    when ${arrayReports.reportPeriod} ~ '^[0-9]{4}-[0-9]{2}$'
      then ${arrayReports.reportPeriod}
    when position(lower(left(${arrayReports.reportPeriod}, 3)) in 'janfebmaraprmayjunjulaugsepoctnovdec') > 0
      then right(${arrayReports.reportPeriod}, 4) || '-' || lpad(
        (((position(lower(left(${arrayReports.reportPeriod}, 3)) in 'janfebmaraprmayjunjulaugsepoctnovdec') + 2) / 3))::text,
        2, '0')
    else '0000-00'
  end
`;

const MONTHS = [
  'jan', 'feb', 'mar', 'apr', 'may', 'jun',
  'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
] as const;

/**
 * The same mapping in TypeScript, for sorting values already in memory.
 *
 * Kept beside the SQL so the two cannot drift; `tests/unit/array-period.test.ts` asserts they
 * agree on the four periods production actually holds.
 */
export function reportPeriodKey(period: string | null | undefined): string {
  const raw = (period ?? '').trim();
  if (/^\d{4}-\d{2}$/.test(raw)) return raw;
  const month = MONTHS.indexOf(raw.slice(0, 3).toLowerCase() as (typeof MONTHS)[number]);
  const year = raw.slice(-4);
  if (month < 0 || !/^\d{4}$/.test(year)) return '0000-00';
  return `${year}-${String(month + 1).padStart(2, '0')}`;
}
