/** Inclusive calendar-month range for the Referrals workspace. Matches the API cap. */
export const REFERRAL_PERIOD_MAX_MONTHS = 12;

export function currentPeriod(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

export function periodLabel(periodMonth: string): string {
  return new Date(`${periodMonth}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function periodRangeLabel(from: string, to: string): string {
  if (from === to) return periodLabel(from);
  return `${periodLabel(from)} – ${periodLabel(to)}`;
}

export function periodFileStamp(from: string, to: string): string {
  return from === to ? from.slice(0, 7) : `${from.slice(0, 7)}_to_${to.slice(0, 7)}`;
}

function utcMonth(periodMonth: string): Date {
  return new Date(`${periodMonth}T00:00:00Z`);
}

export function addMonths(periodMonth: string, delta: number): string {
  const date = utcMonth(periodMonth);
  date.setUTCMonth(date.getUTCMonth() + delta);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

export function monthSpan(from: string, to: string): number {
  const start = utcMonth(from);
  const end = utcMonth(to);
  return (
    (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    (end.getUTCMonth() - start.getUTCMonth()) +
    1
  );
}

export function clampReferralRange(from: string, to: string): { from: string; to: string } {
  const latest = currentPeriod();
  let start = from > latest ? latest : from;
  let end = to > latest ? latest : to;
  if (start > end) start = end;
  if (monthSpan(start, end) > REFERRAL_PERIOD_MAX_MONTHS) {
    end = addMonths(start, REFERRAL_PERIOD_MAX_MONTHS - 1);
    if (end > latest) end = latest;
  }
  return { from: start, to: end };
}
