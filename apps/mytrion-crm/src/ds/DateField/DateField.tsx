import { useCallback, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { Icon, type IconName } from '../Icon/Icon';
import { FieldMessage, cx, describedBy, useFieldIds, type FieldSize } from '../_field/fieldParts';
import { DEFAULT_DATE_LABELS, DateSegments, type DateFieldLabels } from './DateSegments';
import {
  compareDate,
  formatDateLabel,
  parseDate,
  type DateValue,
} from './calendarDate';
import { withDefaults, type Resolved } from '../_field';
import styles from './DateField.module.css';

export type DateFieldSize = FieldSize;

/** The segment names plus the three sentences the field may have to say about a value. */
export interface DateFieldMessages extends DateFieldLabels {
  /** Takes the formatted `min`, so the sentence is the caller's to write and not a concatenation. */
  beforeMin?: ((min: string) => string) | undefined;
  afterMax?: ((max: string) => string) | undefined;
  /** Why `isDateUnavailable` refused this day. Takes the formatted date. */
  unavailable?: ((date: string) => string) | undefined;
}

const DEFAULT_MESSAGES: Resolved<DateFieldMessages> = {
  ...DEFAULT_DATE_LABELS,
  beforeMin: (min) => `Earliest allowed date is ${min}.`,
  afterMax: (max) => `Latest allowed date is ${max}.`,
  unavailable: (date) => `${date} is not available.`,
};

/** Which rule the current value breaks. `null` is "the value is fine, or there is no value yet". */
export type DateViolation = 'before-min' | 'after-max' | 'unavailable' | null;

export interface DateFieldProps {
  /** Controlled ISO `YYYY-MM-DD`, or `null` for empty. Omit entirely to run uncontrolled. */
  value?: DateValue | null | undefined;
  /** Uncontrolled starting value. Ignored once `value` is passed. */
  defaultValue?: DateValue | null | undefined;
  /**
   * Fires with a WHOLE date, or with `null` the instant the entry stops being one. A half-typed
   * date never reaches the caller: `2026-03-` is not a date and pretending otherwise is how a
   * query runs against a period nobody chose.
   */
  onChange?: ((value: DateValue | null) => void) | undefined;
  /** Inclusive earliest allowed date, ISO. Paints invalid; never silently rewrites what was typed. */
  min?: DateValue | undefined;
  /** Inclusive latest allowed date, ISO. */
  max?: DateValue | undefined;
  /**
   * Refuses individual days inside the allowed span — weekends, closed periods, a locked invoice
   * month. Called with an ISO date and must be pure and cheap: the calendar calls it once per
   * visible cell on every render.
   */
  isDateUnavailable?: ((date: DateValue) => boolean) | undefined;
  /** `md` (32px) is the default. `sm` (26px) matches Button and Input in a dense toolbar. */
  size?: DateFieldSize | undefined;
  /**
   * Forces the invalid appearance. ORed with the field's own range checking, so a caller's
   * server-side error and a local range violation cannot cancel each other out.
   */
  invalid?: boolean | undefined;
  /** Hint when valid, error when not. Overrides the built-in range message when supplied. */
  message?: ReactNode | undefined;
  /** Leading icon. Decoration beside a labelled field, so it is hidden from assistive tech. */
  icon?: IconName | undefined;
  disabled?: boolean | undefined;
  /** Readable, focusable, copyable — just not editable. Not the same thing as `disabled`. */
  readOnly?: boolean | undefined;
  /**
   * BCP-47 tag. Governs segment ORDER and month names only — the calendar is always Gregorian and
   * the digits are always latin, because the value is an ISO string bound for a `date` column.
   */
  locale?: string | undefined;
  /** Spans its container. Off by default: most date fields here sit in a filter bar at their own width. */
  fullWidth?: boolean | undefined;
  /** Emits a hidden input, so the field submits with an ordinary `<form>`. */
  name?: string | undefined;
  /** One object for i18n — segment names, placeholders, and the three validation sentences. */
  labels?: DateFieldMessages | undefined;
  /** The affordance slot at the trailing edge. `DatePicker` puts its calendar trigger here. */
  trailing?: ReactNode | undefined;
  /** Accessible name. Required unless `aria-labelledby` points at a visible label. */
  'aria-label'?: string | undefined;
  'aria-labelledby'?: string | undefined;
  'aria-describedby'?: string | undefined;
  /** Positioning class — lands on the ROOT (shell + message), the box a caller lays out. */
  className?: string | undefined;
  style?: CSSProperties | undefined;
  id?: string | undefined;
}

/**
 * The one date field: a SEGMENTED control, one labelled spinbutton per unit.
 *
 * WHY SEGMENTS AND NOT A TEXT BOX. This replaces 36 raw `<input type="date">` across 19 files, and
 * a raw one renders as a different control on every browser and OS. The alternative — a text input
 * with a parser — was rejected outright: `03/04/2026` is 3 April in London and 4 March in Chicago,
 * and a silent misparse in a fuel-card ops tool is an invoice period nobody chose. Segments make
 * the format part of the DOM, so there is nothing to guess. It is also FASTER: an operator entering
 * a known date types it, and typing beats hunting a 7x6 grid for someone doing this forty times a
 * day. The calendar is the secondary affordance (`DatePicker`), never the primary one.
 *
 * THE VALUE IS AN ISO `YYYY-MM-DD` STRING, never a JS `Date`. A `Date` is an instant with a
 * timezone, a calendar date is neither, and `new Date('2026-08-09')` prints as the 8th west of
 * Greenwich. The full argument is at the top of `calendarDate.ts`.
 *
 * KEYBOARD — the whole field is ONE tab stop.
 *   Tab / Shift+Tab   in and out of the field as a unit. Any `trailing` affordance is its own stop
 *                     AFTER the segments, because a button a keyboard user cannot reach is a
 *                     decoration.
 *   Left / Right      previous / next segment, in the LOCALE's order.
 *   Up / Down         step the focused segment. Day and month wrap; the year does not. Stepping an
 *                     EMPTY segment lands on today's value for it, not on the minimum.
 *   0-9               fill left to right. Two digits for day and month, four for the year, and
 *                     focus advances the moment no further digit could fit — `3` in a month means
 *                     March, so there is no second keystroke to wait for.
 *   Home / End        the focused segment's minimum / maximum.
 *   Backspace/Delete  empty the focused segment.
 *
 * OUT OF RANGE IS SHOWN, NOT CORRECTED. A value outside `min`/`max`, or refused by
 * `isDateUnavailable`, paints the danger border, sets `aria-invalid` on the segments and renders a
 * sentence saying which bound it broke. It is never clamped: a control that rewrites what you typed
 * while you are still typing is a control that files the wrong date without telling you.
 *
 * WHEN NOT TO USE IT
 * - A date AND a time. This value has no time in it at all; a timestamp needs a separate control
 *   and a different value type, or the timezone comes back in through the side door.
 * - A month or a quarter — an accounting period is not a day, and a field that makes you pick the
 *   1st is a field that will eventually be given the 2nd.
 * - A range. Two of these wired together drift; use `DateRangePicker`, which owns the swap rule and
 *   announces the span as one thing.
 * - A touch-first surface. These segments are `role="spinbutton"` divs, so a phone keyboard does
 *   not open on them — on mobile the calendar in `DatePicker` is the entry path, not the segments.
 * - Free-form or approximate dates ("Q3", "next week", "around March"). That is a text field with
 *   its own vocabulary, not a calendar date.
 */
export function DateField({
  value,
  defaultValue,
  onChange,
  min,
  max,
  isDateUnavailable,
  size = 'md',
  invalid = false,
  message,
  icon,
  disabled = false,
  readOnly = false,
  locale,
  fullWidth = false,
  name,
  labels,
  trailing,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  'aria-describedby': ariaDescribedBy,
  className,
  style,
  id,
}: DateFieldProps) {
  const { fieldId, messageId } = useFieldIds(id);
  const text = useMemo<Resolved<DateFieldMessages>>(
    () => withDefaults(DEFAULT_MESSAGES, labels),
    [labels],
  );

  // Controlled and uncontrolled through one code path: the caller is the source of truth when it
  // passes `value`, and the mirror below is the source of truth when it does not.
  const controlled = value !== undefined;
  const [inner, setInner] = useState<DateValue | null>(() => defaultValue ?? null);
  const current = controlled ? (value ?? null) : inner;

  const handleChange = useCallback(
    (next: DateValue | null) => {
      if (!controlled) setInner(next);
      onChange?.(next);
    },
    [controlled, onChange],
  );

  const minDate = useMemo(() => parseDate(min), [min]);
  const maxDate = useMemo(() => parseDate(max), [max]);
  const currentDate = useMemo(() => parseDate(current), [current]);

  const violation = useMemo<DateViolation>(() => {
    if (!currentDate || current === null) return null;
    if (minDate && compareDate(currentDate, minDate) < 0) return 'before-min';
    if (maxDate && compareDate(currentDate, maxDate) > 0) return 'after-max';
    if (isDateUnavailable?.(current)) return 'unavailable';
    return null;
  }, [current, currentDate, isDateUnavailable, maxDate, minDate]);

  const isInvalid = invalid || violation !== null;

  // The caller's message always wins. The built-in one exists so an invalid field is never JUST a
  // red border — colour alone is not a signal, and "invalid" with no reason is not an explanation.
  const shownMessage: ReactNode =
    message ??
    (violation === 'before-min' && minDate
      ? text.beforeMin(formatDateLabel(minDate, locale))
      : violation === 'after-max' && maxDate
        ? text.afterMax(formatDateLabel(maxDate, locale))
        : violation === 'unavailable' && currentDate
          ? text.unavailable(formatDateLabel(currentDate, locale))
          : null);

  const describedByIds = describedBy(ariaDescribedBy, shownMessage ? messageId : undefined);

  return (
    <div
      className={cx(styles.root, className)}
      style={style}
      data-size={size}
      data-full={fullWidth || undefined}
    >
      {/*
        data-focus-shell is the contract, not a hint: global.css owns `:focus-within` here and
        clears the outline on the field inside, which is what stops a ring from landing on a single
        segment while the user arrows across three of them.
      */}
      <div
        className={cx(styles.shell)}
        data-focus-shell
        data-invalid={isInvalid || undefined}
        data-disabled={disabled || undefined}
        data-readonly={readOnly || undefined}
        data-filled={current !== null || undefined}
        // A group, because three spinbuttons are one control. Without it a screen reader announces
        // three unrelated numbers with no idea they compose a date.
        role="group"
        id={fieldId}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
      >
        {icon ? <Icon name={icon} size={size === 'sm' ? 'sm' : 'md'} className={cx(styles.leading)} /> : null}

        <DateSegments
          value={current}
          onChange={handleChange}
          {...(minDate ? { minYear: minDate.year } : {})}
          {...(maxDate ? { maxYear: maxDate.year } : {})}
          locale={locale}
          disabled={disabled}
          readOnly={readOnly}
          invalid={isInvalid}
          describedBy={describedByIds}
          labels={text}
        />

        {trailing ? <span className={cx(styles.trailing)}>{trailing}</span> : null}
      </div>

      {/* Hidden, because the segments are divs and a div does not submit. One input carries the
          whole ISO value, which is the same string the API expects. */}
      {name ? <input type="hidden" name={name} value={current ?? ''} /> : null}

      {shownMessage ? (
        <FieldMessage id={messageId} invalid={isInvalid}>
          {shownMessage}
        </FieldMessage>
      ) : null}
    </div>
  );
}
