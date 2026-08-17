/**
 * Inclusive calendar-month range for the live referral workspace.
 *
 * Recurring bonuses stay month-grained ($50 per distinct card in each month, $0.01 per
 * in-month gallon). A day-level from/to would change that money definition, so the API
 * only accepts YYYY-MM-01 and refuses spans longer than a year of months.
 */
export const REFERRAL_PERIOD_MAX_MONTHS = 12;

const MONTH_START = /^(\d{4})-(\d{2})-01$/;

function utcMonth(periodMonth: string): Date {
  const match = MONTH_START.exec(periodMonth);
  if (!match) {
    throw new Error(`Referral period must be YYYY-MM-01, got '${periodMonth}'`);
  }
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
}

/** Inclusive count of calendar months from `from` through `to`. */
export function referralMonthSpan(from: string, to: string): number {
  const start = utcMonth(from);
  const end = utcMonth(to);
  return (
    (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    (end.getUTCMonth() - start.getUTCMonth()) +
    1
  );
}

/** First-of-month strings from `from` through `to`, inclusive. Empty when from > to. */
export function enumerateReferralMonths(from: string, to: string): string[] {
  const span = referralMonthSpan(from, to);
  if (span <= 0) return [];
  const months: string[] = [];
  const cursor = utcMonth(from);
  for (let i = 0; i < span; i += 1) {
    const year = cursor.getUTCFullYear();
    const month = String(cursor.getUTCMonth() + 1).padStart(2, '0');
    months.push(`${year}-${month}-01`);
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return months;
}
