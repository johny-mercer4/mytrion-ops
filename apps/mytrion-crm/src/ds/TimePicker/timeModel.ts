/*
 * TimePicker — the pure half. Parsing, segment arithmetic, and the Intl calls that decide what
 * order the segments go in. Nothing here touches React or the DOM, which is the point: the
 * arithmetic that decides what "ArrowUp on the minute segment" means is the part that is worth
 * testing on its own, and it is also the part that gets copied wrong when it lives inside a
 * component body.
 *
 * NO DATE LIBRARY, by decision. A time-of-day is four small integers; date-fns/dayjs/luxon would be
 * 20-70 KB to add nothing but a wrapper around `%` and `Intl`. `Intl` is used for exactly two
 * things — the ORDER the units appear in, and the localized AM/PM words — and for nothing else.
 */

export type TimeSegmentKind = 'hour' | 'minute' | 'second' | 'dayPeriod';
export type DayPeriod = 'am' | 'pm';

/**
 * The editing model.
 *
 * `hour` is ALWAYS 0-23 whatever the display cycle, because the value type this component emits is
 * always 24-hour. Twelve-hour display is a rendering of this, never a second source of truth — a
 * component that stores "7" and "pm" separately has two ways to spell 19:00 and eventually ships
 * both.
 *
 * `period` is authoritative ONLY while `hour` is null. It exists so that a user who picks "PM"
 * before typing an hour does not have that choice silently thrown away; the moment an hour lands,
 * `period` is re-derived from it.
 */
export interface TimeParts {
  hour: number | null;
  minute: number | null;
  second: number | null;
  period: DayPeriod | null;
}

export const EMPTY_PARTS: TimeParts = { hour: null, minute: null, second: null, period: null };

/** Minutes in a day. The exclusive end of every range in this file. */
const DAY_MINUTES = 24 * 60;

export function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * Strict parse of `HH:mm` / `HH:mm:ss`.
 *
 * DELIBERATELY NOT TOLERANT. It does not accept `9:05`, `0905`, `9.05pm` or anything else a
 * heuristic parser would guess at, and a value it cannot read renders as an EMPTY field rather than
 * as a guess. In a fuel-card ops tool a silently mis-parsed time is a wrong invoice window, and an
 * empty field is a question the operator can answer while a wrong one is not.
 */
export function parseTime(value: string | null | undefined): TimeParts {
  if (typeof value !== 'string') return EMPTY_PARTS;
  const m = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!m) return EMPTY_PARTS;
  const [, hh, mm, ss] = m;
  if (hh === undefined || mm === undefined) return EMPTY_PARTS;
  const hour = Number(hh);
  const minute = Number(mm);
  const second = ss === undefined ? null : Number(ss);
  if (hour > 23 || minute > 59 || (second !== null && second > 59)) return EMPTY_PARTS;
  return { hour, minute, second, period: hour >= 12 ? 'pm' : 'am' };
}

/**
 * The value back out, or `null` when the time is INCOMPLETE.
 *
 * A half-typed time is not a time. Emitting `09:__` as `09:00` would hand the caller a value the
 * user never entered, which is the same failure as a tolerant parser wearing different clothes.
 */
export function formatTime(parts: TimeParts, withSeconds: boolean): string | null {
  const { hour, minute, second } = parts;
  if (hour === null || minute === null) return null;
  if (withSeconds && second === null) return null;
  return withSeconds
    ? `${pad2(hour)}:${pad2(minute)}:${pad2(second ?? 0)}`
    : `${pad2(hour)}:${pad2(minute)}`;
}

/**
 * Comparison key for min/max. Both forms are zero-padded and fixed-width, so once seconds are
 * normalised on, LEXICOGRAPHIC order is chronological order and no arithmetic is needed.
 */
export function timeKey(value: string): string {
  return value.length === 5 ? `${value}:00` : value;
}

/** Minutes since midnight, or `fallback` when the string is not a time this component would emit. */
export function minutesOf(value: string | null | undefined, fallback: number): number {
  const p = parseTime(value);
  if (p.hour === null || p.minute === null) return fallback;
  return p.hour * 60 + p.minute;
}

/* ── Segment arithmetic ─────────────────────────────────────────────────────── */

export interface SegmentRange {
  min: number;
  max: number;
}

export function segmentRange(kind: TimeSegmentKind, hour12: boolean): SegmentRange {
  if (kind === 'hour') return hour12 ? { min: 1, max: 12 } : { min: 0, max: 23 };
  return { min: 0, max: 59 };
}

/** Wrap into [min, max]. Arrow keys wrap because 59 -> 00 is how a clock behaves. */
export function wrapInto(n: number, { min, max }: SegmentRange): number {
  const span = max - min + 1;
  return (((n - min) % span) + span) % span + min;
}

/**
 * One arrow (or page) press on a numeric segment.
 *
 * From EMPTY, Up lands on the segment's minimum and Down on its maximum — predictable in both
 * directions, and it never invents "now", which would make the same keystroke mean a different
 * thing depending on when it was pressed.
 *
 * With a `grain` (the `step` prop), the value SNAPS to the grid rather than adding to an off-grid
 * value: from :07 with a 15-minute step, Up is :15, not :22. A step that produced :22 would not be
 * a step.
 */
export function stepSegment(
  current: number | null,
  delta: number,
  range: SegmentRange,
  grain: number,
): number {
  if (current === null) return delta > 0 ? range.min : range.max;
  if (grain > 1) {
    const snapped =
      delta > 0
        ? Math.floor(current / grain) * grain + grain
        : Math.ceil(current / grain) * grain - grain;
    return wrapInto(snapped, range);
  }
  return wrapInto(current + delta, range);
}

/** 0-23 -> what the 12-hour display shows (1-12). Identity in 24-hour mode. */
export function displayHour(hour: number | null, hour12: boolean): number | null {
  if (hour === null) return null;
  if (!hour12) return hour;
  const h = hour % 12;
  return h === 0 ? 12 : h;
}

/** The inverse: a shown 1-12 plus the current period back to 0-23. Identity in 24-hour mode. */
export function fromDisplayHour(shown: number, period: DayPeriod | null, hour12: boolean): number {
  if (!hour12) return shown;
  const base = shown % 12;
  return (period ?? 'am') === 'pm' ? base + 12 : base;
}

/* ── Layout: what order the units go in, and what sits between them ───────────
   This is the ONLY reason Intl is here. `formatToParts` is asked to lay out a known reference
   instant, and we keep its ORDER and its LITERALS (":", "時", the space before AM in some locales)
   while throwing away the DIGITS it produced.

   Throwing the digits away is deliberate. Intl will happily render Arabic-Indic or Devanagari
   numerals for the locales that use them, and this control's editor accepts ASCII 0-9 from the
   keyboard and emits an ASCII `HH:mm` string. A field that PAINTS ٠٩ and ACCEPTS 09 is a field
   whose display and whose value disagree — so the digits are ours, always ASCII, and only the
   arrangement around them is the locale's. */

export interface TimeLayoutSegment {
  readonly type: 'segment';
  readonly kind: TimeSegmentKind;
}
export interface TimeLayoutLiteral {
  readonly type: 'literal';
  readonly text: string;
}
export type TimeLayoutPart = TimeLayoutSegment | TimeLayoutLiteral;

const HOUR: TimeLayoutSegment = { type: 'segment', kind: 'hour' };
const COLON: TimeLayoutLiteral = { type: 'literal', text: ':' };

function fallbackLayout(hour12: boolean, withSeconds: boolean): TimeLayoutPart[] {
  const out: TimeLayoutPart[] = [HOUR, COLON, { type: 'segment', kind: 'minute' }];
  if (withSeconds) out.push(COLON, { type: 'segment', kind: 'second' });
  if (hour12) out.push({ type: 'literal', text: ' ' }, { type: 'segment', kind: 'dayPeriod' });
  return out;
}

const PART_KIND: Readonly<Record<string, TimeSegmentKind>> = {
  hour: 'hour',
  minute: 'minute',
  second: 'second',
  dayPeriod: 'dayPeriod',
};

/**
 * Segment order and separators for a locale.
 *
 * `hourCycle` is PINNED to h12/h23 rather than left to the locale, and that is not a detail: left
 * alone, some locales resolve to h11 (midnight is 0 AM) or h24 (midnight is 24:00), and this
 * component's value type has exactly one spelling for midnight — `00:00`. Pinning keeps the display
 * and the emitted string describing the same instant.
 *
 * ASSUMPTION, stated because it is load-bearing: every locale CLDR ships orders hour before minute
 * before second. Only the dayPeriod moves (it leads in ja/ko/zh), and that is what this function is
 * for. If that ever stops being true, the segments would still edit correctly — they would just be
 * out of reading order.
 */
export function buildLayout(
  locale: string | undefined,
  hour12: boolean,
  withSeconds: boolean,
): TimeLayoutPart[] {
  try {
    const fmt = new Intl.DateTimeFormat(locale, {
      hour: '2-digit',
      minute: '2-digit',
      ...(withSeconds ? { second: '2-digit' as const } : {}),
      hourCycle: hour12 ? 'h12' : 'h23',
    });
    const out: TimeLayoutPart[] = [];
    for (const part of fmt.formatToParts(new Date(2020, 0, 1, 13, 45, 30))) {
      const kind = PART_KIND[part.type];
      if (kind !== undefined) out.push({ type: 'segment', kind });
      else if (part.type === 'literal') out.push({ type: 'literal', text: part.value });
    }
    // A leading or trailing space is the formatter's, not the field's — the shell owns its padding.
    while (out[0]?.type === 'literal' && out[0].text.trim() === '') out.shift();
    while (out[out.length - 1]?.type === 'literal') {
      const last = out[out.length - 1];
      if (last?.type === 'literal' && last.text.trim() === '') out.pop();
      else break;
    }
    const kinds = out.filter((p): p is TimeLayoutSegment => p.type === 'segment').map((p) => p.kind);
    if (kinds.includes('hour') && kinds.includes('minute')) return out;
  } catch {
    /* An invalid locale tag throws RangeError. Fall through to the ASCII layout. */
  }
  return fallbackLayout(hour12, withSeconds);
}

/**
 * Does this locale show a 12-hour clock by default?
 *
 * `hourCycle` first, `hour12` as the fallback: the two have disagreed across engine versions, and
 * `hourCycle` is the one that distinguishes h11 from h12 (both are "12-hour" for our purposes).
 */
export function localeHour12(locale: string | undefined): boolean {
  try {
    const resolved = new Intl.DateTimeFormat(locale, { hour: 'numeric' }).resolvedOptions();
    const cycle: string | undefined = resolved.hourCycle;
    if (cycle !== undefined) return cycle === 'h11' || cycle === 'h12';
    return resolved.hour12 === true;
  } catch {
    return false;
  }
}

/**
 * The locale's own words for the two day periods — "AM"/"PM", "午前"/"午後", "a. m."/"p. m.".
 *
 * Falls back to ASCII when the engine returns nothing usable (or returns the SAME string for 09:00
 * and 21:00, which some minimal ICU builds do — two identical labels would be a control that cannot
 * be read at all).
 */
export function dayPeriodLabels(locale: string | undefined): Record<DayPeriod, string> {
  try {
    const fmt = new Intl.DateTimeFormat(locale, { hour: 'numeric', hourCycle: 'h12' });
    const read = (hour: number): string | undefined =>
      fmt.formatToParts(new Date(2020, 0, 1, hour)).find((p) => p.type === 'dayPeriod')?.value;
    const am = read(9);
    const pm = read(21);
    if (am !== undefined && pm !== undefined && am !== pm) return { am, pm };
  } catch {
    /* fall through */
  }
  return { am: 'AM', pm: 'PM' };
}

/* ── The increment list ─────────────────────────────────────────────────────── */

/**
 * How many rows the increment listbox will render before it is not worth offering.
 *
 * 288 is a 5-minute grid across a whole day. Below that the list is a genuine shortcut; a 1-minute
 * grid would be 1,440 rows, which is not a shortcut but a second, worse way to type a number.
 */
export const MAX_INCREMENTS = 288;

/**
 * Every time on the `step` grid between `min` and `max`, inclusive.
 *
 * The grid is anchored on `min`, not on midnight: a 15-minute step from 08:05 gives 08:05, 08:20,
 * 08:35 — because a caller who set a floor of 08:05 meant it.
 */
export function buildIncrements(
  step: number,
  min: string | undefined,
  max: string | undefined,
  withSeconds: boolean,
): string[] {
  if (!Number.isFinite(step) || step <= 0) return [];
  const start = minutesOf(min, 0);
  const end = minutesOf(max, DAY_MINUTES - 1);
  if (end < start) return [];
  const out: string[] = [];
  for (let t = start; t <= end && out.length <= MAX_INCREMENTS; t += step) {
    const stamp = `${pad2(Math.floor(t / 60))}:${pad2(t % 60)}`;
    out.push(withSeconds ? `${stamp}:00` : stamp);
  }
  return out.length > MAX_INCREMENTS ? [] : out;
}
