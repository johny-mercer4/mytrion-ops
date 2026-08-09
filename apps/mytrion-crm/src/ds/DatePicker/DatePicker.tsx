import { useCallback, useId, useMemo, useRef, useState } from 'react';
import { Icon, type IconName } from '../Icon/Icon';
import { withDefaults, type Resolved } from '../_field';
import { DateField, type DateFieldMessages, type DateFieldProps } from '../DateField/DateField';
import { formatMonthLabel, parseDate, todayDate, type DateValue, type WeekDay } from '../DateField/calendarDate';
import type { OverlayPlacement } from '../Overlay/anchoring';
import { Calendar, type CalendarLabels } from './Calendar';
import { CalendarPopover } from './CalendarPopover';
import styles from './DatePicker.module.css';

/** Everything the picker can say, in one object, so localising it is one prop and not nine. */
export interface DatePickerMessages extends DateFieldMessages, CalendarLabels {
  /** Accessible name of the trigger button. */
  openCalendar?: string | undefined;
  /** Accessible name of the popover. Say what it CHOOSES, not that it is a dialog. */
  calendar?: string | undefined;
}

const DEFAULT_PICKER_MESSAGES: Resolved<Pick<DatePickerMessages, 'openCalendar' | 'calendar'>> = {
  openCalendar: 'Choose date from calendar',
  calendar: 'Choose date',
};

export interface DatePickerProps
  extends Omit<DateFieldProps, 'trailing' | 'labels' | 'value' | 'defaultValue' | 'onChange'> {
  /** Controlled ISO `YYYY-MM-DD`, or `null` for empty. Omit entirely to run uncontrolled. */
  value?: DateValue | null | undefined;
  defaultValue?: DateValue | null | undefined;
  onChange?: ((value: DateValue | null) => void) | undefined;
  /** `bottom-end` — the panel's trailing edge lines up with the trigger it hangs off. */
  placement?: OverlayPlacement | undefined;
  /** Overrides the locale's own answer for the first column. 0 is Sunday. */
  weekStartsOn?: WeekDay | undefined;
  /** Injectable "today", so a test never has to mock the clock. */
  today?: DateValue | undefined;
  /** The trigger glyph. `calendar_month` by default; `schedule` when the date IS a deadline. */
  triggerIcon?: IconName | undefined;
  /** Fires on every open and close, whatever caused it. The picker owns its own open state. */
  onOpenChange?: ((open: boolean) => void) | undefined;
  labels?: DatePickerMessages | undefined;
}

/**
 * A `DateField` with a calendar behind a trigger button. The SEGMENTS ARE STILL THE PRIMARY CONTROL.
 *
 * That ordering is the design decision, not an implementation detail. An operator entering a known
 * date — the overwhelming majority of entries in this app — types it, and typing beats hunting a
 * 7x6 grid for someone doing this forty times a day. The calendar earns its place for the other
 * case: choosing a date you are reasoning about rather than reciting ("the Monday after the 15th",
 * "the last working day of the month"). It is one keystroke away and never in the way.
 *
 * KEYBOARD
 *   In the field       everything `DateField` documents. One tab stop for all three segments.
 *   Tab                from the segments onto the trigger. It is a real button, so Enter and Space
 *                      open the panel.
 *   In the panel       the grid's APG map — arrows by day and week, PageUp/PageDown by month,
 *                      Shift+PageUp/PageDown by year, Home/End across the week, Enter to select.
 *   Escape             closes, RESTORES THE VALUE THE FIELD HAD WHEN THE PANEL OPENED, and returns
 *                      focus to the trigger. Escape means "I did not mean to do that", so undoing
 *                      the selection is the whole of what it means.
 *   Tab in the panel   cycles inside it.
 *
 * FOCUS ALWAYS COMES BACK. Every keyboard-initiated close returns focus to the trigger; closing by
 * clicking outside does not, because the pointer has already chosen where attention goes. A close
 * that drops focus on `<body>` sends the next Tab back to the top of the document, which is how a
 * keyboard user loses their place.
 *
 * WHEN NOT TO USE IT
 * - A filter bar that wants the calendar visible at all times. A permanent 7x6 grid costs a third
 *   of a dense toolbar; use `DateField` alone, or this, and let the grid be summoned.
 * - A range. Use `DateRangePicker` — two of these wired together have no shared swap rule, no
 *   single announcement, and no way to preview the span between them.
 * - A date and a time together. This value has no time in it; see the `DateField` docblock.
 * - Relative periods ("last 30 days", "this quarter"). Those are presets — a `Select` or a row of
 *   buttons — and forcing them through a calendar makes the user compute the dates themselves.
 */
export function DatePicker({
  value,
  defaultValue,
  onChange,
  placement = 'bottom-end',
  weekStartsOn,
  today,
  triggerIcon = 'calendar_month',
  onOpenChange,
  labels,
  min,
  max,
  isDateUnavailable,
  locale,
  size = 'md',
  disabled = false,
  readOnly = false,
  ...field
}: DatePickerProps) {
  const baseId = useId();
  const panelId = `${baseId}-panel`;
  const text = useMemo(() => withDefaults(DEFAULT_PICKER_MESSAGES, labels), [labels]);

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  // What Escape puts back. Captured at OPEN time, not at mount: the field may have been edited by
  // hand between two openings, and reverting to a value from ten minutes ago is not an undo.
  const restore = useRef<DateValue | null>(null);
  /*
   * Bumped on every open so the `key` below remounts the Calendar. That is what makes the grid land
   * on the CURRENT value each time rather than wherever the user had arrowed to when they last
   * closed it — the alternative is a pile of syncing effects that all mean "reset".
   */
  const [openCount, setOpenCount] = useState(0);

  const controlled = value !== undefined;
  const [inner, setInner] = useState<DateValue | null>(() => defaultValue ?? null);
  const current = controlled ? (value ?? null) : inner;

  const commit = useCallback(
    (next: DateValue | null) => {
      if (!controlled) setInner(next);
      onChange?.(next);
    },
    [controlled, onChange],
  );

  const setOpenState = useCallback(
    (next: boolean) => {
      setOpen(next);
      onOpenChange?.(next);
    },
    [onOpenChange],
  );

  const openPanel = useCallback(() => {
    restore.current = current;
    setOpenCount((count) => count + 1);
    setOpenState(true);
  }, [current, setOpenState]);

  const closePanel = useCallback(
    ({ restoreFocus, cancelled }: { restoreFocus: boolean; cancelled: boolean }) => {
      if (cancelled) commit(restore.current);
      setOpenState(false);
      // Imperative and synchronous: the trigger is NOT inside the portal, so it is still mounted at
      // this instant. Moving focus now — rather than from an effect after the unmount — is what
      // keeps a Tab keypress continuing from the trigger instead of from `<body>`.
      if (restoreFocus) triggerRef.current?.focus();
    },
    [commit, setOpenState],
  );

  const select = useCallback(
    (next: DateValue) => {
      commit(next);
      // A single date is one decision, so the panel's job is done. (A range picker stays open
      // between its two clicks — see DateRangePicker, where closing early would be a bug.)
      closePanel({ restoreFocus: true, cancelled: false });
    },
    [closePanel, commit],
  );

  // The panel's own name carries the month, so a screen-reader user entering the dialog hears where
  // they are before the grid starts reading cells.
  const focusMonth = parseDate(current) ?? parseDate(today) ?? todayDate();
  const panelLabel = `${text.calendar}, ${formatMonthLabel(focusMonth, locale)}`;

  return (
    <>
      <DateField
        {...field}
        value={current}
        onChange={commit}
        min={min}
        max={max}
        isDateUnavailable={isDateUnavailable}
        locale={locale}
        size={size}
        disabled={disabled}
        readOnly={readOnly}
        labels={labels}
        trailing={
          <button
            ref={triggerRef}
            type="button"
            className={styles.trigger}
            aria-label={text.openCalendar}
            aria-haspopup="dialog"
            aria-expanded={open}
            // Only while open: `aria-controls` may only point at an element that exists, and the
            // panel lives in a portal that is unmounted the rest of the time.
            aria-controls={open ? panelId : undefined}
            // aria-disabled rather than the native attribute: the shell already explains WHY the
            // field is unavailable, and a keyboard user has to be able to reach that explanation.
            aria-disabled={disabled || readOnly || undefined}
            onClick={() => {
              if (disabled || readOnly) return;
              if (open) closePanel({ restoreFocus: true, cancelled: false });
              else openPanel();
            }}
          >
            <Icon name={triggerIcon} size={size === 'sm' ? 'sm' : 'md'} />
          </button>
        }
      />

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
          value={current}
          onSelect={select}
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
    </>
  );
}
