/**
 * Which dates of birth the desk is willing to believe.
 *
 * `array_reports.date_of_birth` is the carrier owner's birthday, and it exists for one reason:
 * Metro 2 identifies a consumer by name, address and DOB, so a filing without a usable one is
 * rejected by the bureau. A WRONG one is worse than a missing one — it is filed against a real
 * person's credit file.
 *
 * servercrm's AR-SYNC already refuses implausible values on the way into Zoho
 * (`jobs/arrayReportSync.js`, `validDob`), blanking them rather than sending something the bureau
 * will reject. The SEED path that populated this table did not: `seedArrayReportsFromZoho.js`
 * copies `Date_of_Birth` straight across. So the mirror holds values the sync would never have
 * written — production has two rows on `1191-07-26` (carrier 5785258, May and Jun 2026), which is
 * a typo for 1991 and is the exact example servercrm's comment names.
 *
 * The bounds here are servercrm's, deliberately to the year rather than the day, so the two
 * cannot disagree about a birthday that falls near the boundary:
 *
 *     1920 <= year(dob) <= currentYear - 18
 *
 * This is a READ-side guard. It does not repair the stored value — it stops the desk rendering
 * "Jul 26, 1191" as though it were a fact, and it makes the row count as needing a lookup, which
 * is the truth: nobody knows that owner's birthday.
 */
import { sql, type SQL } from 'drizzle-orm';
import { arrayReports } from '../db/schema/collection.js';

/** Nobody filing freight debt was born before this. Matches servercrm `validDob`. */
export const DOB_MIN_YEAR = 1920;

/** A business owner is an adult. Matches servercrm `validDob`. */
export const DOB_MIN_AGE_YEARS = 18;

/**
 * True when `date_of_birth` is a birthday we would put in front of a collector or a bureau.
 * A SQL expression, safe in WHERE and in a `count(*) FILTER (…)`.
 */
export const hasPlausibleDobSql: SQL<boolean> = sql<boolean>`(
  ${arrayReports.dateOfBirth} IS NOT NULL
  AND extract(year from ${arrayReports.dateOfBirth})
      BETWEEN ${DOB_MIN_YEAR}
      AND (extract(year from current_date) - ${DOB_MIN_AGE_YEARS})
)`;

/**
 * The desk's definition of "this row still needs a birthday".
 *
 * Deliberately WIDER than the stored `needs_dob_lookup` flag: a row can carry `false` from the
 * sync and still hold an unusable date, which is precisely the production case above. The badge,
 * the filter and the KPI tile all read this, so they cannot disagree with each other — the bug
 * that would otherwise show a row as "No DOB" while the "Needs DOB" filter hid it.
 */
export const needsDobLookupSql: SQL<boolean> = sql<boolean>`(
  ${arrayReports.needsDobLookup} IS TRUE OR NOT ${hasPlausibleDobSql}
)`;

/**
 * The same rule in TypeScript, for a value already in memory.
 *
 * Kept beside the SQL so the two cannot drift; `tests/unit/dob-plausibility.test.ts` asserts they
 * agree, including on the real production offender.
 *
 * `now` is injectable because the upper bound moves with the calendar: a test pinned to a literal
 * year would start failing on its own eighteen years from now.
 */
export function hasPlausibleDob(
  value: string | Date | null | undefined,
  now: Date = new Date(),
): boolean {
  if (value == null) return false;
  const iso = value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return false;
  const year = Number(match[1]);
  return year >= DOB_MIN_YEAR && year <= now.getUTCFullYear() - DOB_MIN_AGE_YEARS;
}
