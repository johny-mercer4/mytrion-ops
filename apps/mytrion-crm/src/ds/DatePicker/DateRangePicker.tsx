import {
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { Icon, type IconName } from '../Icon/Icon';
import { withDefaults, type Resolved } from '../_field';
import { FieldMessage, cx, describedBy, useFieldIds, type FieldSize } from '../_field/fieldParts';
import { DateSegments } from '../DateField/DateSegments';
import type { DateFieldMessages } from '../DateField/DateField';
import {
  compareDate,
  formatDateLabel,
  formatMonthLabel,
  isInRange,
  parseDate,
  todayDate,
  type CalendarDate,
  type DateValue,
  type WeekDay,
} from '../DateField/calendarDate';
import type { OverlayPlacement } from '../Overlay/anchoring';
import { Calendar, type CalendarLabels } from './Calendar';
import { CalendarPopover } from './CalendarPopover';
import fieldStyles from '../DateField/DateField.module.css';
import styles from './DatePicker.module.css';

/**
 * Both ends, either of which may be missing while the user is still choosing. A single object
 * rather than two props because the two dates are ONE value — validating, submitting or resetting
 * half a range is never what anybody wants.
 */
export interface DateRange {
  start: DateValue | null;
  end: DateValue | null;
}

export interface DateRangeMessages extends DateFieldMessages, CalendarLabels {
  openCalendar?: string | undefined;
  calendar?: string | undefined;
  /** Names the first half of the field for assistive tech. */
  startDate?: string | undefined;
  endDate?: string | undefined;
  /** Announced once both ends are set. Takes the two formatted dates. */
  rangeSelected?: ((start: string, end: string) => string) | undefined;
  /** Announced after the first click, so the user knows the calendar is waiting for a second one. */
  rangeStarted?: ((start: string) => string) | undefined;
}

type PickerText = Resolved<
  Pick<
    DateRangeMessages,
    'openCalendar' | 'calendar' | 'startDate' | 'endDate' | 'rangeSelected' | 'rangeStarted'
  >
>;

const DEFAULT_RANGE_MESSAGES: PickerText = {
  openCalendar: 'Choose dates from calendar',
  calendar: 'Choose date range',
  startDate: 'Start date',
  endDate: 'End date',
  rangeSelected: (start, end) => `${start} to ${end} selected.`,
  rangeStarted: (start) => `${start} selected. Choose the end date.`,
};

const EMPTY_RANGE: DateRange = { start: null, end: null };

export interface DateRangePickerProps {
  /** Controlled. Omit entirely to run uncontrolled. */
  value?: DateRange | null | undefined;
  defaultValue?: DateRange | null | undefined;
  /** Fires with BOTH ends, already ordered. Either may still be `null` mid-entry. */
  onChange?: ((value: DateRange) => void) | undefined;
  min?: DateValue | undefined;
  max?: DateValue | undefined;
  isDateUnavailable?: ((date: DateValue) => boolean) | undefined;
  size?: FieldSize | undefined;
  /** ORed with the picker's own range checking of both endpoints. */
  invalid?: boolean | undefined;
  message?: ReactNode | undefined;
  icon?: IconName | undefined;
  disabled?: boolean | undefined;
  readOnly?: boolean | undefined;
  locale?: string | undefined;
  weekStartsOn?: WeekDay | undefined;
  today?: DateValue | undefined;
  fullWidth?: boolean | undefined;
  /** Emits two hidden inputs, `${name}-start` and `${name}-end`, so the field submits with a form. */
  name?: string | undefined;
  placement?: OverlayPlacement | undefined;
  /** `calendar_month` by default. `date_range` reads as a span; `schedule` when the span is a deadline. */
  triggerIcon?: IconName | undefined;
  onOpenChange?: ((open: boolean) => void) | undefined;
  labels?: DateRangeMessages | undefined;
  /** Accessible name for the whole control. Required unless `aria-labelledby` names it. */
  'aria-label'?: string | undefined;
  'aria-labelledby'?: string | undefined;
  'aria-describedby'?: string | undefined;
  className?: string | undefined;
  style?: CSSProperties | undefined;
  id?: string | undefined;
}

/** Low-to-high. The whole swap policy, in one function, so the two entry paths cannot disagree. */
function order(range: DateRange): DateRange {
  const start = parseDate(range.start);
  const end = parseDate(range.end);
  if (!start || !end || compareDate(start, end) <= 0) return range;
  return { start: range.end, end: range.start };
}

/**
 * Two dates as one control: two segmented fields, one calendar, one value.
 *
 * WHY IT SWAPS INSTEAD OF ERRORING. Choosing the later day first is not a mistake, it is a normal
 * way to think ("up to the 12th… from the 3rd"). Refusing it would make the user do the ordering
 * that this component can do for free, and an error message for a range it fully understands is an
 * error message that trains people to ignore error messages. Ordering happens on every path — typed
 * into either half, or clicked in the grid — through the one `order()` above.
 *
 * ONE CALENDAR, NOT TWO. A second month doubles the panel to say what PageDown already says, and on
 * a dense workspace the panel then covers the table the user is filtering. The first click sets the
 * anchor, the grid previews the span under the cursor, the second click closes it.
 *
 * KEYBOARD
 *   Tab                 start segments -> end segments -> trigger. Each date is ONE tab stop; the
 *                       arrow keys move between and within its units, per `DateField`.
 *   In the panel        the grid's APG map. The first Enter anchors the range, the second closes it.
 *   Escape              closes, RESTORES the range the field held when the panel opened, and
 *                       returns focus to the trigger.
 *
 * WHAT IT ANNOUNCES. A polite live region carries the range as a sentence — "3 March 2026 to
 * 12 March 2026 selected" — because the two halves are separate widgets and nothing else would ever
 * tell a screen-reader user what the pair now means. After the first click it says which end is
 * still missing, which is the one piece of guidance a half-made range genuinely needs.
 *
 * WHEN NOT TO USE IT
 * - A single date. `DatePicker`. A range field with one end filled in is a puzzle.
 * - Named periods — "this month", "last quarter", "year to date". Those are presets; making an
 *   operator translate "last quarter" into two dates forty times a day is the work this tool exists
 *   to remove. Offer the presets and let this be the escape hatch beside them.
 * - Spans measured in months or years. Twelve PageDowns is not navigation.
 * - Two dates that are not a span — a hire date and a review date are two `DatePicker`s with two
 *   labels, and pairing them here implies an ordering rule that does not exist.
 */
export function DateRangePicker({
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
  weekStartsOn,
  today,
  fullWidth = false,
  name,
  placement = 'bottom-end',
  triggerIcon = 'calendar_month',
  onOpenChange,
  labels,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  'aria-describedby': ariaDescribedBy,
  className,
  style,
  id,
}: DateRangePickerProps) {
  const baseId = useId();
  const panelId = `${baseId}-panel`;
  const { fieldId, messageId } = useFieldIds(id);
  const text = useMemo(() => withDefaults(DEFAULT_RANGE_MESSAGES, labels), [labels]);

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [openCount, setOpenCount] = useState(0);
  const restore = useRef<DateRange>(EMPTY_RANGE);

  /** The first endpoint of an in-progress selection. `null` means the next click starts a new range. */
  const [anchor, setAnchor] = useState<DateValue | null>(null);
  /** The day under the pointer while an anchor is set. Painted, never committed. */
  const [preview, setPreview] = useState<DateValue | null>(null);
  const [announcement, setAnnouncement] = useState('');

  const controlled = value !== undefined;
  const [inner, setInner] = useState<DateRange>(() => defaultValue ?? EMPTY_RANGE);
  const current = controlled ? (value ?? EMPTY_RANGE) : inner;

  const commit = useCallback(
    (next: DateRange) => {
      const ordered = order(next);
      if (!controlled) setInner(ordered);
      onChange?.(ordered);
    },
    [controlled, onChange],
  );

  const minDate = useMemo(() => parseDate(min), [min]);
  const maxDate = useMemo(() => parseDate(max), [max]);

  /** An endpoint is illegal if it is outside the bounds or refused by the predicate. */
  const illegal = useCallback(
    (iso: DateValue | null): boolean => {
      const parsed: CalendarDate | null = parseDate(iso);
      if (!parsed || iso === null) return false;
      if (!isInRange(parsed, minDate, maxDate)) return true;
      return isDateUnavailable?.(iso) ?? false;
    },
    [isDateUnavailable, maxDate, minDate],
  );

  const isInvalid = invalid || illegal(current.start) || illegal(current.end);

  const setOpenState = useCallback(
    (next: boolean) => {
      setOpen(next);
      onOpenChange?.(next);
    },
    [onOpenChange],
  );

  const openPanel = useCallback(() => {
    restore.current = current;
    setAnchor(null);
    setPreview(null);
    setOpenCount((count) => count + 1);
    setOpenState(true);
  }, [current, setOpenState]);

  const closePanel = useCallback(
    ({ restoreFocus, cancelled }: { restoreFocus: boolean; cancelled: boolean }) => {
      if (cancelled) commit(restore.current);
      setAnchor(null);
      setPreview(null);
      setOpenState(false);
      // Synchronous, while the trigger is still mounted — the portal's unmount must not be what
      // decides where focus lands. See the same note in DatePicker.
      if (restoreFocus) triggerRef.current?.focus();
    },
    [commit, setOpenState],
  );

  /**
   * A click in the grid. First one anchors, second one completes — and completing is the only place
   * the panel closes on its own, because a range is two decisions and closing after the first would
   * be closing halfway through the sentence.
   */
  const pick = useCallback(
    (iso: DateValue) => {
      const parsed = parseDate(iso);
      if (!parsed) return;

      if (anchor === null) {
        setAnchor(iso);
        setPreview(null);
        commit({ start: iso, end: null });
        setAnnouncement(text.rangeStarted(formatDateLabel(parsed, locale)));
        return;
      }

      const next = order({ start: anchor, end: iso });
      setAnchor(null);
      setPreview(null);
      commit(next);
      const low = parseDate(next.start);
      const high = parseDate(next.end);
      if (low && high) {
        setAnnouncement(
          text.rangeSelected(formatDateLabel(low, locale), formatDateLabel(high, locale)),
        );
      }
      closePanel({ restoreFocus: true, cancelled: false });
    },
    [anchor, closePanel, commit, locale, text],
  );

  const focusMonth = parseDate(current.start) ?? parseDate(today) ?? todayDate();
  const panelLabel = `${text.calendar}, ${formatMonthLabel(focusMonth, locale)}`;
  const describedByIds = describedBy(ariaDescribedBy, message ? messageId : undefined);
  const iconSize = size === 'sm' ? 'sm' : 'md';

  return (
    <div
      className={cx(fieldStyles.root, styles.rangeRoot, className)}
      style={style}
      data-size={size}
      data-full={fullWidth || undefined}
    >
      {/*
        The shell chrome comes from DateField.module.css rather than being restated here: "the box a
        date field lives in" has one author, so a range picker and a single one cannot drift half a
        pixel apart in the same filter bar. Only what is genuinely different — the separator, the
        two halves — is local.
      */}
      <div
        className={cx(fieldStyles.shell)}
        data-focus-shell
        data-invalid={isInvalid || undefined}
        data-disabled={disabled || undefined}
        data-readonly={readOnly || undefined}
        data-filled={(current.start !== null || current.end !== null) || undefined}
        role="group"
        id={fieldId}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
      >
        {icon ? <Icon name={icon} size={iconSize} className={cx(fieldStyles.leading)} /> : null}

        <DateSegments
          value={current.start}
          onChange={(next) => commit({ start: next, end: current.end })}
          {...(minDate ? { minYear: minDate.year } : {})}
          {...(maxDate ? { maxYear: maxDate.year } : {})}
          locale={locale}
          disabled={disabled}
          readOnly={readOnly}
          invalid={isInvalid}
          describedBy={describedByIds}
          groupLabel={text.startDate}
        />

        {/* An en dash, hidden from assistive tech: the two halves are already named "Start date"
            and "End date", so a spoken "dash" between them adds a word and no information. */}
        <span className={cx(styles.rangeDash)} aria-hidden="true">
          –
        </span>

        <DateSegments
          value={current.end}
          onChange={(next) => commit({ start: current.start, end: next })}
          {...(minDate ? { minYear: minDate.year } : {})}
          {...(maxDate ? { maxYear: maxDate.year } : {})}
          locale={locale}
          disabled={disabled}
          readOnly={readOnly}
          invalid={isInvalid}
          describedBy={describedByIds}
          groupLabel={text.endDate}
        />

        <span className={cx(fieldStyles.trailing)}>
          <button
            ref={triggerRef}
            type="button"
            className={styles.trigger}
            aria-label={text.openCalendar}
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-controls={open ? panelId : undefined}
            aria-disabled={disabled || readOnly || undefined}
            onClick={() => {
              if (disabled || readOnly) return;
              if (open) closePanel({ restoreFocus: true, cancelled: false });
              else openPanel();
            }}
          >
            <Icon name={triggerIcon} size={iconSize} />
          </button>
        </span>
      </div>

      {name ? (
        <>
          <input type="hidden" name={`${name}-start`} value={current.start ?? ''} />
          <input type="hidden" name={`${name}-end`} value={current.end ?? ''} />
        </>
      ) : null}

      {message ? (
        <FieldMessage id={messageId} invalid={isInvalid}>
          {message}
        </FieldMessage>
      ) : null}

      {/* The pair, as a sentence. Two separate widgets cannot announce what they mean TOGETHER, and
          the span is the only thing the user actually chose. */}
      <span className={cx(styles.srOnly)} aria-live="polite" aria-atomic="true">
        {announcement}
      </span>

      <CalendarPopover
        open={open}
        triggerRef={triggerRef}
        onClose={closePanel}
        label={panelLabel}
        placement={placement}
        id={panelId}
      >
        <Calendar
          key={openCount}
          rangeStart={anchor ?? current.start}
          rangeEnd={anchor === null ? current.end : null}
          previewEnd={anchor === null ? null : preview}
          onSelect={pick}
          onHoverDate={setPreview}
          defaultFocusedDate={current.start ?? undefined}
          autoFocus
          min={min}
          max={max}
          isDateUnavailable={isDateUnavailable}
          locale={locale}
          weekStartsOn={weekStartsOn}
          today={today}
          labels={labels}
        />
      </CalendarPopover>
    </div>
  );
}
