import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  dateFieldParts,
  daysInMonth,
  formatIso,
  isValidDate,
  monthNames,
  parseDate,
  todayDate,
  type DateSegmentType,
  type DateValue,
} from './calendarDate';
import { type Resolved } from '../_field';
import styles from './DateField.module.css';

/**
 * The segment engine. INTERNAL — `DateField` and `DateRangePicker` render it inside their own
 * shell; it has no border, no message row and no label of its own, because both of its hosts
 * already own those and a second one would be a second author for the same appearance.
 *
 * It is a separate file rather than a hook because the state, the keyboard and the markup are one
 * thing: every rule below ("commit only a whole date", "clamp the day when the month changes",
 * "advance when no further digit can fit") is simultaneously a state transition and a DOM effect.
 */

/** Partial entry is a first-class state: a user types a month before they have typed a year. */
interface Segments {
  year: number | null;
  month: number | null;
  day: number | null;
}

export interface DateFieldLabels {
  /** Accessible name of the day segment. */
  day?: string | undefined;
  /** Accessible name of the month segment. */
  month?: string | undefined;
  /** Accessible name of the year segment. */
  year?: string | undefined;
  /** `aria-valuetext` for a segment with nothing in it. Announced instead of a number. */
  empty?: string | undefined;
  /** Shown in place of an unfilled day. Two characters, so the field does not resize as it fills. */
  dayPlaceholder?: string | undefined;
  monthPlaceholder?: string | undefined;
  yearPlaceholder?: string | undefined;
}

export const DEFAULT_DATE_LABELS: Resolved<DateFieldLabels> = {
  day: 'day',
  month: 'month',
  year: 'year',
  empty: 'Empty',
  dayPlaceholder: 'dd',
  monthPlaceholder: 'mm',
  yearPlaceholder: 'yyyy',
};

export interface DateSegmentsProps {
  /** Fully controlled on the COMPLETE value. Partial entry lives inside; a half-typed date is not one. */
  value: DateValue | null;
  /** Fires with the whole date, or `null` the moment the entry stops being a whole date. */
  onChange: (value: DateValue | null) => void;
  /** Narrows the year segment's `aria-valuemin`. Does NOT clamp typing — see the DateField docblock. */
  minYear?: number | undefined;
  maxYear?: number | undefined;
  locale?: string | undefined;
  disabled?: boolean | undefined;
  readOnly?: boolean | undefined;
  /**
   * Lands as `aria-invalid` on every segment, not on the wrapper. `group` does not support
   * `aria-invalid`; `spinbutton` does, and the segments are what a user is focused on when they
   * need to hear it.
   */
  invalid?: boolean | undefined;
  /**
   * Id of the message that explains the state. Also placed per-SEGMENT, for the same reason: a
   * description hanging off a `group` is not reliably announced when focus lands on a child.
   */
  describedBy?: string | undefined;
  labels?: Resolved<DateFieldLabels> | undefined;
  /**
   * Turns the wrapper into a named `role="group"`. Pass it when one shell holds MORE than one of
   * these — a range picker's two halves need "Start date" and "End date", or a screen reader hears
   * six numbers in a row with no boundary between the two dates.
   */
  groupLabel?: string | undefined;
  /** Placed on the wrapper so the host's shell can lay several of these out in a row. */
  className?: string | undefined;
}

/** How long a partly-typed segment keeps accepting a second digit. The APG typeahead figure. */
const TYPING_RESET_MS = 1500;


function segmentWidth(type: DateSegmentType): number {
  return type === 'year' ? 4 : 2;
}

function toSegments(value: DateValue | null): Segments {
  const parsed = parseDate(value);
  return parsed
    ? { year: parsed.year, month: parsed.month, day: parsed.day }
    : { year: null, month: null, day: null };
}

function toIso(segments: Segments): DateValue | null {
  const { year, month, day } = segments;
  if (year === null || month === null || day === null) return null;
  if (!isValidDate(year, month, day)) return null;
  return formatIso({ year, month, day });
}

export function DateSegments({
  value,
  onChange,
  minYear,
  maxYear,
  locale,
  disabled = false,
  readOnly = false,
  invalid = false,
  describedBy,
  labels = DEFAULT_DATE_LABELS,
  groupLabel,
  className,
}: DateSegmentsProps) {
  const parts = useMemo(() => dateFieldParts(locale), [locale]);
  const months = useMemo(() => monthNames(locale), [locale]);

  const [segments, setSegments] = useState<Segments>(() => toSegments(value));
  // Mirrored so a keystroke can compute the NEXT state from the current one without waiting for a
  // render — two digits typed inside one frame must both land.
  const segmentsRef = useRef<Segments>(segments);
  const [active, setActive] = useState<DateSegmentType>(() => {
    const first = parts.find((part) => part.kind === 'segment');
    return first && first.kind === 'segment' ? first.type : 'day';
  });

  const nodes = useRef(new Map<DateSegmentType, HTMLDivElement>());
  /*
   * The half-typed digits, held TWICE on purpose. The ref is read synchronously by the next
   * keystroke, which may arrive before React has re-rendered; the state is what the DOM shows.
   * Ref alone was the bug: the idle timer clears the buffer without scheduling a render, so a
   * segment left holding a lone `0` would keep painting `00` after the value behind it was gone.
   */
  const typing = useRef<{
    type: DateSegmentType | null;
    text: string;
    timer: ReturnType<typeof setTimeout> | null;
  }>({ type: null, text: '', timer: null });
  const [draft, setDraft] = useState<{ type: DateSegmentType; text: string } | null>(null);

  const clearTyping = useCallback(() => {
    const state = typing.current;
    if (state.timer !== null) clearTimeout(state.timer);
    state.timer = null;
    state.type = null;
    state.text = '';
    setDraft(null);
  }, []);

  // Unmount clears the TIMER only — a `setDraft` from a cleanup would be a state update on a
  // component that no longer exists, which is noise rather than a fix.
  useEffect(
    () => () => {
      if (typing.current.timer !== null) clearTimeout(typing.current.timer);
    },
    [],
  );

  /*
   * Pull the controlled value back in when it changes for a reason that is not this component.
   * The guard is what makes it safe: after our own `onChange`, the parent re-renders with exactly
   * the ISO we just emitted, `toIso` matches, and the effect does nothing — so a half-typed date
   * survives the round trip instead of being wiped by the `null` we correctly reported.
   */
  useEffect(() => {
    const incoming = value ?? null;
    if (toIso(segmentsRef.current) === incoming) return;
    const next = toSegments(incoming);
    segmentsRef.current = next;
    setSegments(next);
  }, [value]);

  const apply = useCallback(
    (next: Segments) => {
      segmentsRef.current = next;
      setSegments(next);
      onChange(toIso(next));
    },
    [onChange],
  );

  /**
   * Writes one segment, then repairs the day.
   *
   * 31 March with the month stepped to April has to become 30 April; leaving 31 would put the field
   * in a state that is not a date and quietly emit `null`, so the value would vanish because the
   * user pressed ArrowUp once. When the year is still empty the clamp assumes a LEAP year, so a 29
   * February typed before its year survives long enough to be told which year it is.
   */
  const writeSegment = useCallback(
    (type: DateSegmentType, next: number | null) => {
      const current = segmentsRef.current;
      const draft: Segments = { ...current, [type]: next };
      if ((type === 'month' || type === 'year') && draft.day !== null && draft.month !== null) {
        const limit = daysInMonth(draft.year ?? 2024, draft.month);
        if (draft.day > limit) draft.day = limit;
      }
      apply(draft);
    },
    [apply],
  );

  const bounds = useCallback(
    (type: DateSegmentType): { min: number; max: number } => {
      if (type === 'month') return { min: 1, max: 12 };
      if (type === 'year') return { min: minYear ?? 1, max: maxYear ?? 9999 };
      const { year, month } = segmentsRef.current;
      // 31 until a month is known: a day segment that refuses 31 before you have said "March" is a
      // segment that fights the order people type in.
      return { min: 1, max: month === null ? 31 : daysInMonth(year ?? 2024, month) };
    },
    [maxYear, minYear],
  );

  const focusSegment = useCallback((type: DateSegmentType) => {
    setActive(type);
    nodes.current.get(type)?.focus();
  }, []);

  /** Segment order is the LOCALE's, not the type's — `next` after month is the year in `en-US`. */
  const shift = useCallback(
    (type: DateSegmentType, delta: number) => {
      const order = parts.flatMap((part) => (part.kind === 'segment' ? [part.type] : []));
      const index = order.indexOf(type);
      const target = order[index + delta];
      if (target) focusSegment(target);
    },
    [focusSegment, parts],
  );

  const step = useCallback(
    (type: DateSegmentType, delta: number) => {
      clearTyping();
      const { min, max } = bounds(type);
      const current = segmentsRef.current[type];
      if (current === null) {
        // Stepping an empty segment lands on TODAY's value for it, not on the minimum. An operator
        // reaching for the arrow keys is nearly always working near now, and 0001 is never the
        // answer they wanted.
        writeSegment(type, todayDate()[type]);
        return;
      }
      // Day and month WRAP (31 -> 1); the year does not. A wrapping year turns one extra ArrowUp
      // into a four-digit jump, and nobody scrolls a year expecting to arrive in the first century.
      const raw = current + delta;
      const next =
        type === 'year'
          ? Math.min(Math.max(raw, min), max)
          : raw > max
            ? min
            : raw < min
              ? max
              : raw;
      writeSegment(type, next);
    },
    [bounds, clearTyping, writeSegment],
  );

  /**
   * A digit. Fills left to right, restarts when the running number would exceed the segment, and
   * advances the moment no further digit could fit — typing `3` in a month means March and only
   * March, so waiting for a second keystroke would be waiting for one that is never coming.
   */
  const typeDigit = useCallback(
    (type: DateSegmentType, digit: string) => {
      const state = typing.current;
      const width = segmentWidth(type);
      const { max } = bounds(type);

      const prefix = state.type === type ? state.text : '';
      let text = prefix + digit;
      if (text.length > width) text = digit;
      if (Number(text) > max) text = digit;

      const parsed = Number(text);
      // A lone `0` is a legitimate first keystroke ("05") but not a legitimate value. It stays in
      // the buffer and shows as `00`, and the segment holds no value until a real digit follows.
      const committed = parsed >= 1 ? parsed : null;

      if (state.timer !== null) clearTimeout(state.timer);
      state.type = type;
      state.text = text;
      state.timer = setTimeout(clearTyping, TYPING_RESET_MS);
      setDraft({ type, text });

      writeSegment(type, committed);

      const complete = text.length >= width || parsed * 10 > max;
      if (committed !== null && complete) {
        clearTyping();
        shift(type, 1);
      }
    },
    [bounds, clearTyping, shift, writeSegment],
  );

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>, type: DateSegmentType) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      switch (event.key) {
        case 'ArrowUp':
          event.preventDefault();
          if (!disabled && !readOnly) step(type, 1);
          return;
        case 'ArrowDown':
          event.preventDefault();
          if (!disabled && !readOnly) step(type, -1);
          return;
        case 'ArrowLeft':
          event.preventDefault();
          clearTyping();
          shift(type, -1);
          return;
        case 'ArrowRight':
          event.preventDefault();
          clearTyping();
          shift(type, 1);
          return;
        case 'Home':
          event.preventDefault();
          if (!disabled && !readOnly) {
            clearTyping();
            writeSegment(type, bounds(type).min);
          }
          return;
        case 'End':
          event.preventDefault();
          if (!disabled && !readOnly) {
            clearTyping();
            writeSegment(type, bounds(type).max);
          }
          return;
        case 'Backspace':
        case 'Delete':
          event.preventDefault();
          if (!disabled && !readOnly) {
            clearTyping();
            writeSegment(type, null);
          }
          return;
        default:
          break;
      }

      if (/^\d$/.test(event.key)) {
        event.preventDefault();
        if (!disabled && !readOnly) typeDigit(type, event.key);
      }
      // Everything else falls through untouched — Tab still leaves the field, and a browser or
      // screen-reader shortcut is not swallowed by a control that had no use for it.
    },
    [bounds, clearTyping, disabled, readOnly, shift, step, typeDigit, writeSegment],
  );

  const register = (type: DateSegmentType) => (node: HTMLDivElement | null) => {
    if (node) nodes.current.set(type, node);
    else nodes.current.delete(type);
  };

  const placeholderFor = (type: DateSegmentType): string =>
    type === 'day'
      ? labels.dayPlaceholder
      : type === 'month'
        ? labels.monthPlaceholder
        : labels.yearPlaceholder;

  const renderSegment = (type: DateSegmentType) => {
    const width = segmentWidth(type);
    const committed = segments[type];
    const buffered = draft && draft.type === type && draft.text !== '' ? draft.text : null;
    const shown =
      committed !== null
        ? String(committed).padStart(width, '0')
        : buffered !== null
          ? buffered.padStart(width, '0')
          : null;

    const { min, max } = bounds(type);
    const valueText =
      committed === null
        ? labels.empty
        : type === 'month'
          ? // The month NAME, never the number. "3" over a screen reader is the exact ambiguity the
            // segmented field exists to remove, and it is the one segment where a name exists.
            (months[committed - 1] ?? String(committed))
          : String(committed);

    return (
      <div
        key={type}
        ref={register(type)}
        // A spinbutton, not a text input: the value is one bounded number with a name, which is
        // precisely what the role means, and it is what makes ArrowUp announce "March" rather than
        // re-reading the whole field.
        role="spinbutton"
        // Roving: exactly ONE segment is in the document tab order, so Tab moves past the field as
        // a unit and the arrow keys walk inside it. A three-tab date field is a date field people
        // tab straight past.
        tabIndex={active === type ? 0 : -1}
        className={styles.segment}
        aria-label={labels[type]}
        aria-valuemin={min}
        aria-valuemax={max}
        // Omitted entirely when empty. `aria-valuenow="0"` would announce a value the field does
        // not have; `aria-valuetext` carries "Empty" instead.
        {...(committed === null ? {} : { 'aria-valuenow': committed })}
        aria-valuetext={valueText}
        aria-disabled={disabled || undefined}
        aria-readonly={readOnly || undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        data-type={type}
        data-placeholder={shown === null || undefined}
        onKeyDown={(event) => onKeyDown(event, type)}
        onFocus={() => setActive(type)}
        onBlur={clearTyping}
      >
        {shown ?? placeholderFor(type)}
      </div>
    );
  };

  return (
    <div
      className={[styles.segments, className].filter(Boolean).join(' ')}
      // Only when named. An unnamed `role="group"` is a boundary a screen reader announces and a
      // user learns nothing from; a single-date field is already grouped by its own shell.
      {...(groupLabel ? { role: 'group', 'aria-label': groupLabel } : {})}
    >
      {parts.map((part, index) =>
        part.kind === 'segment' ? (
          renderSegment(part.type)
        ) : (
          // Separators are painted, not announced: each segment already says which unit it is, and
          // hearing "slash" between "month, 3" and "day, 4" is noise, not structure.
          <span
            // Literals have no identity of their own — two locales use '/' twice in one field — so
            // the position IS the key.
            key={`literal-${String(index)}`}
            className={styles.literal}
            aria-hidden="true"
          >
            {part.text}
          </span>
        ),
      )}
    </div>
  );
}
