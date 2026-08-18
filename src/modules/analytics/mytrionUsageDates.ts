import { AppError } from '../../lib/errors.js';
import type { MytrionUsageRangePreset } from './mytrionUsageTypes.js';

export const MYTRION_USAGE_TIME_ZONE = 'America/New_York';

export interface MytrionUsageWindow {
  preset: MytrionUsageRangePreset;
  from: string;
  to: string;
  start: Date;
  endExclusive: Date;
}

function parseIsoDate(date: string): [number, number, number] {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const year = Number(match?.[1]);
  const month = Number(match?.[2]);
  const day = Number(match?.[3]);
  if (!match || !Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    throw new AppError('Analytics dates must use YYYY-MM-DD', {
      statusCode: 400,
      code: 'INVALID_ANALYTICS_RANGE',
      expose: true,
    });
  }
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  if (
    calendarDate.getUTCFullYear() !== year ||
    calendarDate.getUTCMonth() !== month - 1 ||
    calendarDate.getUTCDate() !== day
  ) {
    throw new AppError('Analytics dates must be valid calendar dates', {
      statusCode: 400,
      code: 'INVALID_ANALYTICS_RANGE',
      expose: true,
    });
  }
  return [year, month, day];
}

function dateParts(at: Date, timeZone: string): Record<string, number> {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const out: Record<string, number> = {};
  for (const part of parts) {
    if (part.type !== 'literal') out[part.type] = Number(part.value);
  }
  return out;
}

/** Convert a local calendar midnight to its UTC instant, including DST offset changes. */
export function zonedDayStart(date: string, timeZone = MYTRION_USAGE_TIME_ZONE): Date {
  const [year, month, day] = parseIsoDate(date);
  const target = Date.UTC(year, month - 1, day);
  let guess = target;
  for (let i = 0; i < 3; i += 1) {
    const p = dateParts(new Date(guess), timeZone);
    const represented = Date.UTC(
      p.year ?? year,
      (p.month ?? month) - 1,
      p.day ?? day,
      p.hour ?? 0,
      p.minute ?? 0,
      p.second ?? 0,
    );
    guess = target - (represented - guess);
  }
  return new Date(guess);
}

function isoDate(at: Date, timeZone = MYTRION_USAGE_TIME_ZONE): string {
  const p = dateParts(at, timeZone);
  return `${String(p.year).padStart(4, '0')}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

export function addDays(date: string, amount: number): string {
  const [year, month, day] = parseIsoDate(date);
  const next = new Date(Date.UTC(year, month - 1, day + amount));
  return next.toISOString().slice(0, 10);
}

export function usageDates(from: string, to: string): string[] {
  const dates: string[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) dates.push(date);
  return dates;
}

export function resolveMytrionUsageWindow(input: {
  preset?: MytrionUsageRangePreset;
  from?: string;
  to?: string;
  now?: Date;
}): MytrionUsageWindow {
  const now = input.now ?? new Date();
  const today = isoDate(now);
  const preset = input.preset ?? 'this_month';
  let from: string;
  let to: string;
  if (preset === 'custom') {
    if (!input.from || !input.to) {
      throw new AppError('Custom ranges require both from and to dates', {
        statusCode: 400,
        code: 'INVALID_ANALYTICS_RANGE',
        expose: true,
      });
    }
    from = input.from;
    to = input.to;
  } else if (preset === 'today') {
    from = today;
    to = today;
  } else if (preset === 'last_7_days') {
    from = addDays(today, -6);
    to = today;
  } else {
    from = `${today.slice(0, 8)}01`;
    to = today;
  }
  if (to > today) {
    throw new AppError('Analytics ranges cannot extend into the future', {
      statusCode: 400,
      code: 'INVALID_ANALYTICS_RANGE',
      expose: true,
    });
  }
  if (from > to || usageDates(from, to).length > 366) {
    throw new AppError('Analytics range must be ordered and no longer than 366 days', {
      statusCode: 400,
      code: 'INVALID_ANALYTICS_RANGE',
      expose: true,
    });
  }
  return {
    preset,
    from,
    to,
    start: zonedDayStart(from),
    endExclusive: zonedDayStart(addDays(to, 1)),
  };
}
