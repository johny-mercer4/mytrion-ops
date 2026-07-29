import { ValidationError } from '../../../lib/errors.js';
import type { HrHolidaySession, HrLeaveDayPart } from '../../../db/schema/index.js';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

export interface LeaveHoliday {
  date: string;
  isHalfDay: boolean;
  session: HrHolidaySession | null;
}

function parseIsoDate(value: string): Date {
  if (!ISO_DATE.test(value)) throw new ValidationError('Expected date in YYYY-MM-DD format');
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new ValidationError('Invalid calendar date');
  }
  return date;
}

function sameSession(part: HrLeaveDayPart, session: HrHolidaySession | null): boolean {
  return part !== 'full' && part === session;
}

/** Calendar year used for the entitlement. Cross-year requests are intentionally split. */
export function leaveYear(fromDate: string, toDate: string): number {
  const from = parseIsoDate(fromDate);
  const to = parseIsoDate(toDate);
  if (from.getTime() > to.getTime()) throw new ValidationError('From date must be before To date');
  if (from.getUTCFullYear() !== to.getUTCFullYear()) {
    throw new ValidationError('A leave request cannot cross calendar years');
  }
  return from.getUTCFullYear();
}

/**
 * Count chargeable workdays. Weekends and full holidays cost zero; half-day holidays cost 0.5.
 * A morning/afternoon request is supported for a single date only.
 */
export function calculateLeaveDays(input: {
  fromDate: string;
  toDate: string;
  dayPart: HrLeaveDayPart;
  holidays: readonly LeaveHoliday[];
}): number {
  const from = parseIsoDate(input.fromDate);
  const to = parseIsoDate(input.toDate);
  leaveYear(input.fromDate, input.toDate);
  if (input.dayPart !== 'full' && input.fromDate !== input.toDate) {
    throw new ValidationError('Half-day leave must start and end on the same date');
  }

  const holidayByDate = new Map(input.holidays.map((holiday) => [holiday.date, holiday]));
  let days = 0;
  for (let cursor = from.getTime(); cursor <= to.getTime(); cursor += DAY_MS) {
    const date = new Date(cursor);
    const weekday = date.getUTCDay();
    if (weekday === 0 || weekday === 6) continue;

    const iso = date.toISOString().slice(0, 10);
    const holiday = holidayByDate.get(iso);
    if (holiday && !holiday.isHalfDay) continue;

    if (input.dayPart !== 'full') {
      if (!holiday || !sameSession(input.dayPart, holiday.session)) days += 0.5;
      continue;
    }
    days += holiday?.isHalfDay ? 0.5 : 1;
  }
  if (days <= 0) throw new ValidationError('The selected range contains no working leave days');
  return Math.round(days * 2) / 2;
}
