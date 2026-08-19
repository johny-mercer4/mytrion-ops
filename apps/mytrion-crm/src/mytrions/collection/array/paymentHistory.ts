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
  /** "May 2026", derived by counting back from the report period. */
  month: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Month label `n` places before a `YYYY-MM` period. Returns null when the period is unparseable —
 * the strip then renders positions without dates rather than inventing them.
 */
export function monthBefore(period: string | null | undefined, n: number): string | null {
  const m = /^(\d{4})-(\d{2})$/.exec((period ?? '').trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]) - 1 - n;
  const y = year + Math.floor(month / 12);
  const mo = ((month % 12) + 12) % 12;
  return `${MONTHS[mo]} ${y}`;
}

/**
 * Parse the profile into months, newest first.
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
      month: monthBefore(reportPeriod, index) ?? `${index + 1} month${index === 0 ? '' : 's'} back`,
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
