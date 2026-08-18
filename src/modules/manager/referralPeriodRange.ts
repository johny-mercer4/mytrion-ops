/**
 * Inclusive calendar-day range for the live referral workspace.
 *
 * Recurring bonuses are still settled per calendar month ($50 per first-use swipe, $0.01 per
 * In Station gallon). A from/to filter clips each overlapping month to the days inside the range.
 * First-use still sees every earlier eligible row so a card that first fueled before the window
 * is not counted again.
 *
 * `period_month=YYYY-MM-01` remains a full-month shorthand. `period_from`/`period_to` are days.
 */
export const REFERRAL_PERIOD_MAX_MONTHS = 12;
export const REFERRAL_PERIOD_MAX_DAYS = 366;

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIsoDate(value: string): boolean {
  const match = ISO_DAY.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function requireIsoDate(value: string): void {
  if (!isIsoDate(value)) {
    throw new Error(`Referral period must be a real YYYY-MM-DD date, got '${value}'`);
  }
}

function utcMonthStart(isoDate: string): Date {
  requireIsoDate(isoDate);
  return new Date(Date.UTC(Number(isoDate.slice(0, 4)), Number(isoDate.slice(5, 7)) - 1, 1));
}

function formatIsoDay(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function monthStartOf(isoDate: string): string {
  requireIsoDate(isoDate);
  return `${isoDate.slice(0, 7)}-01`;
}

export function lastDayOfMonth(isoDate: string): string {
  requireIsoDate(isoDate);
  const date = new Date(Date.UTC(Number(isoDate.slice(0, 4)), Number(isoDate.slice(5, 7)), 0));
  return formatIsoDay(date);
}

/** Inclusive count of calendar months from `from`'s month through `to`'s month. */
export function referralMonthSpan(from: string, to: string): number {
  const start = utcMonthStart(from);
  const end = utcMonthStart(to);
  return (
    (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    (end.getUTCMonth() - start.getUTCMonth()) +
    1
  );
}

/** Inclusive count of calendar days from `from` through `to`. */
export function referralDaySpan(from: string, to: string): number {
  requireIsoDate(from);
  requireIsoDate(to);
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  return Math.round((end - start) / 86_400_000) + 1;
}

/** First-of-month strings for every calendar month that overlaps `[from, to]`. */
export function enumerateReferralMonths(from: string, to: string): string[] {
  const span = referralMonthSpan(from, to);
  if (span <= 0) return [];
  const months: string[] = [];
  const cursor = utcMonthStart(from);
  for (let i = 0; i < span; i += 1) {
    months.push(formatIsoDay(cursor));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return months;
}

/** Days of `monthStart` that also sit inside the requested from/to window. */
export function clipReferralMonthWindow(
  monthStart: string,
  rangeFrom: string,
  rangeTo: string,
): { from: string; to: string } {
  const monthTo = lastDayOfMonth(monthStart);
  return {
    from: rangeFrom > monthStart ? rangeFrom : monthStart,
    to: rangeTo < monthTo ? rangeTo : monthTo,
  };
}
