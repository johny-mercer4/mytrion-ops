/**
 * The calendar-date model shared by DateField, DatePicker and DateRangePicker.
 *
 * NO DATE LIBRARY. Everything here is `Intl` for locale knowledge (segment ORDER, month and weekday
 * NAMES) plus plain field arithmetic for the rest. That is a deliberate 0 KB, and it is affordable
 * only because a calendar date is a much smaller problem than an instant.
 *
 * ── THE VALUE IS AN ISO 'YYYY-MM-DD' STRING ─────────────────────────────────────────────────────
 * Not a JS `Date`, and not a `{ year, month, day }` object. Three reasons, in order of how much
 * they have cost this codebase:
 *
 *  1. A `Date` is an INSTANT — a millisecond offset from the epoch, rendered through a timezone. A
 *     calendar date is neither. `new Date('2026-08-09')` parses as UTC midnight, so west of
 *     Greenwich it prints as the 8th; that one line is the off-by-one-day bug behind every "the
 *     report is a day early" ticket. A string cannot drift, because there is nothing to render.
 *  2. It is already the wire format. `<input type="date">` produces exactly this, JSON carries it
 *     unchanged, Postgres `date` returns it, and it sorts and compares with `<` because ISO 8601 is
 *     designed to. A `{ y, m, d }` object needs a serialiser at every one of those boundaries.
 *  3. Two equal dates are `===` equal. That makes it usable as a `useEffect` dependency, a `useMemo`
 *     key and a React `key` with no deep compare — an object value re-fires every effect it touches
 *     on every render.
 *
 * `CalendarDate` below is the ARITHMETIC record, parsed at the edge and formatted back at the edge.
 * It is exported because a caller doing its own month maths needs it, not because it is the value.
 *
 * ── GREGORIAN, LATIN DIGITS. LOCALE GOVERNS ORDER AND NAMES ONLY ────────────────────────────────
 * Every `Intl` call below pins `calendar: 'gregory'` and `numberingSystem: 'latn'`. This is an
 * assumption and it is documented rather than hidden: an internal fuel-card ops tool reconciles
 * against carrier invoices and a Postgres `date` column, both of which are proleptic Gregorian. If
 * the locale were allowed to pick, `ar-SA` would hand back Hijri months and Eastern Arabic digits,
 * and the numeric segments would be editing a number the backend has never seen. Locale still
 * decides whether the field reads D/M/Y or M/D/Y and what the months are called — which is the part
 * that actually prevents a misread.
 *
 * ── THE ONLY `Date` IN THE SYSTEM ───────────────────────────────────────────────────────────────
 * `addDays`, `weekdayOf` and `todayDate` construct one, at LOCAL NOON, and never let it escape.
 * Noon rather than midnight because in a handful of zones (Santiago, São Paulo historically, Lord
 * Howe) the DST jump happens AT midnight, so local midnight is a time that does not exist and the
 * runtime silently shifts it — occasionally across the date line of the day itself. Noon is twelve
 * hours from either edge and no transition has ever been that large.
 */

/** Month is 1-12 and day is 1-31, i.e. what a human says — not `Date`'s 0-11 month. */
export interface CalendarDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

/** An ISO 8601 calendar date, `YYYY-MM-DD`. The value type of every component in this group. */
export type DateValue = string;

/** Which weekday a week starts on. 0 is Sunday, matching `Date.prototype.getDay`. */
export type WeekDay = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** Anchored at both ends, so `2026-08-09T00:00:00Z` and `26-8-9` are both rejected rather than half-read. */
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

/** Proleptic Gregorian: divisible by 4, except centuries, except every fourth century. */
export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  // noUncheckedIndexedAccess: the lookup is `number | undefined` even though month is 1-12 here.
  // 31 is the honest fallback for a month index that cannot occur — never NaN, which would
  // propagate silently through every comparison downstream.
  return MONTH_LENGTHS[month - 1] ?? 31;
}

/** True when the three fields name a day that exists. Rejects 2026-02-30 and 2026-13-01. */
export function isValidDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (year < 1 || year > 9999) return false;
  if (month < 1 || month > 12) return false;
  return day >= 1 && day <= daysInMonth(year, month);
}

/**
 * Parses an ISO date, returning `null` for anything that is not exactly one.
 *
 * Strict on purpose. A lenient parser is how '03/04/2026' becomes 3 April in one place and 4 March
 * in another; the whole reason this control is segmented is that a date must never be GUESSED.
 */
export function parseDate(value: string | null | undefined): CalendarDate | null {
  if (typeof value !== 'string') return null;
  const match = ISO_DATE.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!isValidDate(year, month, day)) return null;
  return { year, month, day };
}

function pad(value: number, length: number): string {
  return String(value).padStart(length, '0');
}

export function formatIso(date: CalendarDate): DateValue {
  return `${pad(date.year, 4)}-${pad(date.month, 2)}-${pad(date.day, 2)}`;
}

/** Negative when `a` is earlier. Field-by-field, so it never allocates a `Date`. */
export function compareDate(a: CalendarDate, b: CalendarDate): number {
  if (a.year !== b.year) return a.year - b.year;
  if (a.month !== b.month) return a.month - b.month;
  return a.day - b.day;
}

export function isSameDate(a: CalendarDate | null, b: CalendarDate | null): boolean {
  if (!a || !b) return a === b;
  return compareDate(a, b) === 0;
}

/** Inclusive at both ends. A `null` bound is "no bound", not "the epoch". */
export function isInRange(
  date: CalendarDate,
  min: CalendarDate | null,
  max: CalendarDate | null,
): boolean {
  if (min && compareDate(date, min) < 0) return false;
  if (max && compareDate(date, max) > 0) return false;
  return true;
}

export function clampDate(
  date: CalendarDate,
  min: CalendarDate | null,
  max: CalendarDate | null,
): CalendarDate {
  if (min && compareDate(date, min) < 0) return min;
  if (max && compareDate(date, max) > 0) return max;
  return date;
}

/** A local-noon `Date` for the given fields. Private — see the timezone note in the file header. */
function atNoon(date: CalendarDate): Date {
  return new Date(date.year, date.month - 1, date.day, 12, 0, 0, 0);
}

function fromNative(native: Date): CalendarDate {
  return { year: native.getFullYear(), month: native.getMonth() + 1, day: native.getDate() };
}

/**
 * Day arithmetic, through the runtime's own calendar rollover — this is the one operation where
 * hand-rolled field maths (borrow a month, borrow a year, remember February) is longer AND more
 * likely to be wrong than letting the platform normalise an overflowing day number.
 */
export function addDays(date: CalendarDate, amount: number): CalendarDate {
  return fromNative(new Date(date.year, date.month - 1, date.day + amount, 12, 0, 0, 0));
}

/**
 * Month arithmetic with the day CLAMPED, not rolled over: 31 January plus one month is 28 February,
 * not 3 March. Native `Date` overflow gives the second answer, which is why this is field maths and
 * `addDays` is not.
 */
export function addMonths(date: CalendarDate, amount: number): CalendarDate {
  const total = date.year * 12 + (date.month - 1) + amount;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  return { year, month, day: Math.min(date.day, daysInMonth(year, month)) };
}

/** Same clamping rule as `addMonths`, so 29 February plus one year is 28 February. */
export function addYears(date: CalendarDate, amount: number): CalendarDate {
  const year = date.year + amount;
  return { year, month: date.month, day: Math.min(date.day, daysInMonth(year, date.month)) };
}

/** 0 = Sunday, matching `Date.prototype.getDay` and the `WeekDay` type. */
export function weekdayOf(date: CalendarDate): WeekDay {
  return atNoon(date).getDay() as WeekDay;
}

export function startOfMonth(date: CalendarDate): CalendarDate {
  return { year: date.year, month: date.month, day: 1 };
}

export function endOfMonth(date: CalendarDate): CalendarDate {
  return { year: date.year, month: date.month, day: daysInMonth(date.year, date.month) };
}

export function startOfWeek(date: CalendarDate, weekStartsOn: WeekDay): CalendarDate {
  const offset = (weekdayOf(date) - weekStartsOn + 7) % 7;
  return addDays(date, -offset);
}

/**
 * Today, on the USER'S wall clock.
 *
 * Deliberately a function and not a module constant: a constant is evaluated once at import and a
 * dashboard left open overnight would then mark yesterday as today. Every component that needs it
 * also accepts a `today` prop, so a test never has to mock the clock.
 */
export function todayDate(): CalendarDate {
  return fromNative(new Date());
}

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   Intl — locale knowledge, and nothing else
   ══════════════════════════════════════════════════════════════════════════════════════════════ */

/** Pinned on every formatter below. See the Gregorian/latin note in the file header. */
const CALENDAR_OPTIONS = { calendar: 'gregory', numberingSystem: 'latn' } as const;

export type DateSegmentType = 'day' | 'month' | 'year';

/**
 * One piece of the segmented field: either an editable segment or the separator between two of
 * them. A discriminated union rather than a nullable `type`, so the renderer cannot forget the case.
 */
export type DateFieldPart =
  | { readonly kind: 'segment'; readonly type: DateSegmentType }
  | { readonly kind: 'literal'; readonly text: string };

/** Y-M-D with hyphens. Used only when a locale hands back parts we cannot map — never as a default. */
const FALLBACK_PARTS: readonly DateFieldPart[] = [
  { kind: 'segment', type: 'year' },
  { kind: 'literal', text: '-' },
  { kind: 'segment', type: 'month' },
  { kind: 'literal', text: '-' },
  { kind: 'segment', type: 'day' },
];

/**
 * The segment ORDER and the separators for a locale — 'M/D/Y' for `en-US`, 'D.M.Y' for `de-DE`,
 * 'Y/M/D' for `ja-JP` — read off `Intl` rather than hardcoded.
 *
 * This is the whole reason the control is segmented. The order is DECLARED by the DOM, one labelled
 * spinbutton per unit, so there is no format to misread and nothing to parse; '03/04/2026' is
 * ambiguous prose, but a segment announcing "month, 3" is not.
 */
export function dateFieldParts(locale?: string | undefined): readonly DateFieldPart[] {
  const formatter = new Intl.DateTimeFormat(locale, {
    ...CALENDAR_OPTIONS,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  // A reference date whose day, month and year are all distinct two-digit numbers, so no part can
  // be matched to the wrong field by coincidence.
  const parts = formatter.formatToParts(new Date(2026, 10, 22, 12, 0, 0, 0));

  const out: DateFieldPart[] = [];
  for (const part of parts) {
    if (part.type === 'day' || part.type === 'month' || part.type === 'year') {
      out.push({ kind: 'segment', type: part.type });
    } else if (part.type === 'literal') {
      out.push({ kind: 'literal', text: part.value });
    }
    // Anything else — 'era', 'relatedYear', 'yearName' on a non-Gregorian chain — is dropped. We
    // pinned the calendar, so these should not appear; if a runtime produces them anyway, the
    // completeness check below catches it.
  }

  const segments = out.filter((part) => part.kind === 'segment').length;
  if (segments !== 3) return FALLBACK_PARTS;
  // A leading or trailing literal is real in some locales (ja-JP ends in 日). Only an EMPTY one is
  // noise, and it would render as a stray gap between two segments.
  return out.filter((part) => part.kind === 'segment' || part.text.length > 0);
}

/** The twelve month names, long form, index 0 = January. For `aria-valuetext` on the month segment. */
export function monthNames(locale?: string | undefined): readonly string[] {
  const formatter = new Intl.DateTimeFormat(locale, { ...CALENDAR_OPTIONS, month: 'long' });
  return Array.from({ length: 12 }, (_, index) =>
    formatter.format(new Date(2026, index, 15, 12, 0, 0, 0)),
  );
}

export interface WeekdayName {
  /** Two or three letters for the column header — what a dense grid can afford. */
  readonly short: string;
  /** The full name, carried for assistive tech. 'Mo' is not a word anyone should have to hear. */
  readonly long: string;
}

/** The seven weekday names, rotated so index 0 is `weekStartsOn`. */
export function weekdayNames(
  locale: string | undefined,
  weekStartsOn: WeekDay,
): readonly WeekdayName[] {
  const shortFmt = new Intl.DateTimeFormat(locale, { ...CALENDAR_OPTIONS, weekday: 'short' });
  const longFmt = new Intl.DateTimeFormat(locale, { ...CALENDAR_OPTIONS, weekday: 'long' });
  // 1 January 2023 was a Sunday, so `+ index` walks Sunday..Saturday with no lookup table.
  return Array.from({ length: 7 }, (_, index) => {
    const native = new Date(2023, 0, 1 + ((weekStartsOn + index) % 7), 12, 0, 0, 0);
    return { short: shortFmt.format(native), long: longFmt.format(native) };
  });
}

/** The shape `Intl.Locale` exposes week rules through. Not in TypeScript's DOM lib yet — see below. */
interface WeekInfoCarrier {
  readonly weekInfo?: { readonly firstDay?: number } | undefined;
  readonly getWeekInfo?: (() => { readonly firstDay?: number }) | undefined;
}

/**
 * Which day the week starts on for a locale: Sunday in the US, Monday across most of Europe,
 * Saturday in much of the Middle East.
 *
 * `Intl.Locale.prototype.getWeekInfo()` is the standard answer and ships in current engines, but it
 * is not in TypeScript's bundled lib and older Safari exposes it as a `weekInfo` GETTER rather than
 * a method. Hence one narrow cast — to an interface naming exactly the two shapes, not to `any` —
 * and a Sunday fallback for the runtimes that have neither. `firstDay` is 1-7 with 7 for Sunday
 * (ISO-8601), so `% 7` converts it to this file's 0-6 with 0 for Sunday.
 */
export function resolveWeekStart(locale?: string | undefined): WeekDay {
  try {
    const resolved = new Intl.Locale(locale ?? new Intl.DateTimeFormat().resolvedOptions().locale);
    const carrier = resolved as unknown as WeekInfoCarrier;
    const info = typeof carrier.getWeekInfo === 'function' ? carrier.getWeekInfo() : carrier.weekInfo;
    const firstDay = info?.firstDay;
    if (typeof firstDay === 'number' && firstDay >= 1 && firstDay <= 7) {
      return (firstDay % 7) as WeekDay;
    }
  } catch {
    // An unparseable locale tag. Fall through rather than take the whole field down with it.
  }
  return 0;
}

/**
 * 'Monday, 3 March 2026' — the spoken form of a day cell and of a range announcement.
 * Long, not numeric: a screen-reader user hearing "3/4/2026" has the same ambiguity problem the
 * segments exist to remove.
 */
export function formatDateLabel(date: CalendarDate, locale?: string | undefined): string {
  return new Intl.DateTimeFormat(locale, {
    ...CALENDAR_OPTIONS,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(atNoon(date));
}

/** 'March 2026' — the calendar's own heading, and what the live region announces on navigation. */
export function formatMonthLabel(date: CalendarDate, locale?: string | undefined): string {
  return new Intl.DateTimeFormat(locale, {
    ...CALENDAR_OPTIONS,
    year: 'numeric',
    month: 'long',
  }).format(atNoon(date));
}
