/** Inclusive calendar-day range for the Referrals workspace. Matches the API caps. */
export const REFERRAL_PERIOD_MAX_MONTHS = 12;
export const REFERRAL_PERIOD_MAX_DAYS = 366;

export function utcToday(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
}

export function currentPeriodFrom(): string {
  return `${utcToday().slice(0, 7)}-01`;
}

export function currentPeriodTo(): string {
  return utcToday();
}

export function monthLabel(isoDate: string): string {
  return new Date(`${isoDate.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function periodLabel(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function periodRangeLabel(from: string, to: string): string {
  if (from === to) return periodLabel(from);
  return `${periodLabel(from)} – ${periodLabel(to)}`;
}

export function periodFileStamp(from: string, to: string): string {
  return from === to ? from : `${from}_to_${to}`;
}

function utcDay(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00Z`);
}

export function addDays(isoDate: string, delta: number): string {
  const date = utcDay(isoDate);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

export function addMonths(periodMonth: string, delta: number): string {
  const date = utcDay(`${periodMonth.slice(0, 7)}-01`);
  date.setUTCMonth(date.getUTCMonth() + delta);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

export function lastDayOfMonth(isoDate: string): string {
  const date = utcDay(`${isoDate.slice(0, 7)}-01`);
  date.setUTCMonth(date.getUTCMonth() + 1);
  date.setUTCDate(0);
  return date.toISOString().slice(0, 10);
}

export function monthSpan(from: string, to: string): number {
  const start = utcDay(`${from.slice(0, 7)}-01`);
  const end = utcDay(`${to.slice(0, 7)}-01`);
  return (
    (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    (end.getUTCMonth() - start.getUTCMonth()) +
    1
  );
}

export function daySpan(from: string, to: string): number {
  return Math.round((utcDay(to).getTime() - utcDay(from).getTime()) / 86_400_000) + 1;
}

/** First of `month` through its last day, clamped so the current month ends today. */
export function rangeForMonth(monthStart: string): { from: string; to: string } {
  const start = `${monthStart.slice(0, 7)}-01`;
  return clampReferralRange(start, lastDayOfMonth(start));
}

export function clampReferralRange(from: string, to: string): { from: string; to: string } {
  const latest = utcToday();
  let start = from > latest ? latest : from;
  let end = to > latest ? latest : to;
  if (start > end) start = end;
  if (daySpan(start, end) > REFERRAL_PERIOD_MAX_DAYS) {
    end = addDays(start, REFERRAL_PERIOD_MAX_DAYS - 1);
    if (end > latest) end = latest;
  }
  if (monthSpan(start, end) > REFERRAL_PERIOD_MAX_MONTHS) {
    end = lastDayOfMonth(addMonths(start, REFERRAL_PERIOD_MAX_MONTHS - 1));
    if (end > latest) end = latest;
  }
  return { from: start, to: end };
}
