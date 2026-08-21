/**
 * Metro 2 Payment History Profile — 24 characters, one per month, most recent FIRST.
 *
 * This is the densest field on an Array tradeline and the screen used to print it raw:
 * `000000000000BBBBBBBBBBBB`. That string is two years of payment behaviour — the single most
 * useful thing on the record for deciding whether a debtor pays — and in that form nobody reads
 * it. Parsed here into months a strip can draw.
 *
 * Codes are the CDIA Metro 2 set. `B` and `D` are ABSENCE of data, not good standing, and are
 * drawn as gaps rather than as a status: reporting "no history" as if it were "current" would
 * turn a carrier we know nothing about into one that looks reliable.
 *
 * Pure — no React. Covered by paymentHistory.test.ts.
 */

export type HistoryTone = 'current' | 'late' | 'severe' | 'derogatory' | 'none';

export interface HistoryCode {
  /** What the character means, in the operator's words. */
  label: string;
  tone: HistoryTone;
}

export const HISTORY_CODES: Record<string, HistoryCode> = {
  '0': { label: 'Current', tone: 'current' },
  '1': { label: '30–59 days past due', tone: 'late' },
  '2': { label: '60–89 days past due', tone: 'late' },
  '3': { label: '90–119 days past due', tone: 'severe' },
  '4': { label: '120–149 days past due', tone: 'severe' },
  '5': { label: '150–179 days past due', tone: 'severe' },
  '6': { label: '180+ days past due', tone: 'derogatory' },
  B: { label: 'No history reported', tone: 'none' },
  D: { label: 'No history before this point', tone: 'none' },
  E: { label: 'Zero balance, current', tone: 'current' },
  G: { label: 'Collection', tone: 'derogatory' },
  H: { label: 'Foreclosure completed', tone: 'derogatory' },
  J: { label: 'Voluntary surrender', tone: 'derogatory' },
  K: { label: 'Repossession', tone: 'derogatory' },
  L: { label: 'Charge-off', tone: 'derogatory' },
};

export interface HistoryMonth {
  /** Position in the profile, 0 = most recent. */
  index: number;
  code: string;
  label: string;
  tone: HistoryTone;
  /** "Jul 2026" — the month this position covers, one further back per position. */
  month: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Month label `n` places before a report period.
 *
 * Accepts BOTH shapes the period comes in. Production writes `'Aug 2026'` — servercrm's AR-SYNC
 * builds it with `toLocaleString('en-US', { month: 'short', year: 'numeric' })` — while fixtures
 * and local seeds use `'2026-08'`. Only the second was handled here, so every real record fell
 * through to the null branch and the whole strip rendered as "1 month back, 2 months back…".
 *
 * Returns null for anything else, and the strip then shows positions without dates rather than
 * inventing them.
 */
export function monthBefore(period: string | null | undefined, n: number): string | null {
  const raw = (period ?? '').trim();
  const iso = /^(\d{4})-(\d{2})$/.exec(raw);
  const named = /^([A-Za-z]{3})[a-z]*\s+(\d{4})$/.exec(raw);

  let year: number;
  let monthIndex: number;
  if (iso) {
    year = Number(iso[1]);
    monthIndex = Number(iso[2]) - 1;
  } else if (named) {
    const abbrev = (named[1] ?? '').toLowerCase();
    const found = MONTHS.findIndex((m) => m.toLowerCase() === abbrev);
    if (found < 0) return null;
    year = Number(named[2]);
    monthIndex = found;
  } else {
    return null;
  }
  if (monthIndex < 0 || monthIndex > 11) return null;

  const month = monthIndex - n;
  const y = year + Math.floor(month / 12);
  const mo = ((month % 12) + 12) % 12;
  return `${MONTHS[mo]} ${y}`;
}

/**
 * Parse the profile into months, newest first.
 *
 * POSITION 0 IS THE MONTH BEFORE THE REPORT PERIOD, not the report period itself. The generator
 * says so outright — `servercrm/jobs/arrayReportSync.js`: "Position 0 = the most recent month-end
 * (= previous reporting period)" — and its `monthEndUTC(today, i)` returns day 0 of month
 * `(month - i)`, which is the last day of `(month - i - 1)`. An August filing therefore opens on
 * July. Labelling position 0 as August, as this did, put every one of the 24 cells a month early.
 *
 * An unrecognised character is kept and shown as unknown rather than dropped — a code we do not
 * have a label for is still a month the bureau reported something in, and silently omitting it
 * would shift every month after it onto the wrong date.
 */
export function parsePaymentHistory(
  profile: string | null | undefined,
  reportPeriod?: string | null,
): HistoryMonth[] {
  const raw = (profile ?? '').trim().toUpperCase();
  if (!raw) return [];
  return [...raw].map((char, index) => {
    const known = HISTORY_CODES[char];
    return {
      index,
      code: char,
      label: known?.label ?? `Unrecognised code ${char}`,
      tone: known?.tone ?? 'none',
      month: monthBefore(reportPeriod, index + 1) ?? `${index + 1} month${index === 0 ? '' : 's'} back`,
    };
  });
}

/**
 * The one-line read on a profile: worst status reached, and how many months were actually
 * reported. "12 of 24 months reported" is the caveat that stops a short history being mistaken
 * for a clean one.
 */
export function summarisePaymentHistory(months: readonly HistoryMonth[]): {
  reported: number;
  worst: HistoryMonth | null;
  clean: boolean;
} {
  const order: Record<HistoryTone, number> = {
    none: 0,
    current: 1,
    late: 2,
    severe: 3,
    derogatory: 4,
  };
  const reported = months.filter((m) => m.tone !== 'none');
  let worst: HistoryMonth | null = null;
  for (const m of reported) {
    if (!worst || order[m.tone] > order[worst.tone]) worst = m;
  }
  return {
    reported: reported.length,
    worst,
    clean: reported.length > 0 && worst?.tone === 'current',
  };
}
