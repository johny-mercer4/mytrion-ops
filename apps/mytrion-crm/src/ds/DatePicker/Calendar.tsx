import {
  useCallback,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import { Icon } from '../Icon/Icon';
import {
  addDays,
  addMonths,
  addYears,
  clampDate,
  compareDate,
  formatDateLabel,
  formatIso,
  formatMonthLabel,
  isInRange,
  isSameDate,
  parseDate,
  resolveWeekStart,
  startOfMonth,
  startOfWeek,
  todayDate,
  weekdayNames,
  type CalendarDate,
  type DateValue,
  type WeekDay,
} from '../DateField/calendarDate';
import { withDefaults, type Resolved } from '../_field';
import styles from './Calendar.module.css';

export interface CalendarLabels {
  previousMonth?: string | undefined;
  nextMonth?: string | undefined;
}

const DEFAULT_LABELS: Resolved<CalendarLabels> = {
  previousMonth: 'Previous month',
  nextMonth: 'Next month',
};

export interface CalendarProps {
  /** The chosen day, ISO. For a range, pass `rangeStart`/`rangeEnd` instead. */
  value?: DateValue | null | undefined;
  /** Start of a highlighted span. */
  rangeStart?: DateValue | null | undefined;
  /** End of a highlighted span. */
  rangeEnd?: DateValue | null | undefined;
  /**
   * Provisional far end while the second endpoint is still being chosen — the pointer's hovered day
   * or the keyboard's focused one. Painted like the real span but never committed.
   */
  previewEnd?: DateValue | null | undefined;
  /** Fires for any legal day. Unavailable days do not fire at all. */
  onSelect: (date: DateValue) => void;
  /** Pointer moved onto (or off, with `null`) a day. Only wire it up when previewing a range. */
  onHoverDate?: ((date: DateValue | null) => void) | undefined;
  /** Where the roving focus starts. Defaults to the value, then the range start, then today. */
  defaultFocusedDate?: DateValue | undefined;
  /** Takes DOM focus on mount. The popover passes `true`; an inline calendar should not. */
  autoFocus?: boolean | undefined;
  min?: DateValue | undefined;
  max?: DateValue | undefined;
  isDateUnavailable?: ((date: DateValue) => boolean) | undefined;
  locale?: string | undefined;
  /** Overrides the locale's own answer. 0 is Sunday. */
  weekStartsOn?: WeekDay | undefined;
  /** Injectable "today", so a test never has to mock the clock. Defaults to the user's wall clock. */
  today?: DateValue | undefined;
  labels?: CalendarLabels | undefined;
  className?: string | undefined;
  style?: CSSProperties | undefined;
}

/** Six rows, always. See the comment on `weeks` below — this is a layout stability decision. */
const ROWS = 6;

/**
 * The month grid. The SECONDARY affordance behind `DatePicker`'s trigger, never the primary one:
 * an operator entering a known date types it into the segments, and a 7x6 grid is slower than
 * typing for someone doing this forty times a day.
 *
 * IT IS A `role="grid"`, NOT A `role="application"`. React DayPicker offers the latter and it is a
 * trap: `application` switches a screen reader out of its own browse mode, so the user loses the
 * navigation they have spent years learning in exchange for whatever this component invented. A
 * grid is a structure assistive tech already knows how to read — rows, columns, a selected cell.
 *
 * IT DOES NOT ANNOUNCE ITS OWN KEYBOARD HELP. The APG habit of firing the full "use arrow keys to
 * navigate…" paragraph into a live region on every open is fine once and hostile on the fortieth
 * open of the day. What the live region carries instead is the ONE thing that changes and is not
 * otherwise announced: the visible month, when navigation moves it.
 *
 * KEYBOARD (WAI-ARIA APG, date picker dialog)
 *   Left / Right          +- one day
 *   Up / Down             +- one week
 *   PageUp / PageDown     +- one month
 *   Shift+PageUp / Down   +- one year
 *   Home / End            first / last day of the focused WEEK
 *   Enter / Space         select the focused day (native — each day is a real `<button>`)
 * Escape and focus restoration belong to whatever opens the calendar; see `CalendarPopover`.
 *
 * WHEN NOT TO USE IT
 * - As the always-visible control in a filter bar. A permanent 7x6 grid on a dense workspace costs
 *   a third of the toolbar to say what three segments say in a row.
 * - To pick a month or a quarter. Days are the wrong unit and users will pick the 1st and mean the
 *   month, which is a different value that nothing validates.
 * - For a span longer than a couple of months. Scrubbing 18 months one PageDown at a time is not
 *   navigation; offer presets.
 */
export function Calendar({
  value,
  rangeStart,
  rangeEnd,
  previewEnd,
  onSelect,
  onHoverDate,
  defaultFocusedDate,
  autoFocus = false,
  min,
  max,
  isDateUnavailable,
  locale,
  weekStartsOn,
  today,
  labels,
  className,
  style,
}: CalendarProps) {
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const text = useMemo(() => withDefaults(DEFAULT_LABELS, labels), [labels]);

  const minDate = useMemo(() => parseDate(min), [min]);
  const maxDate = useMemo(() => parseDate(max), [max]);
  const selected = useMemo(() => parseDate(value), [value]);
  const startDate = useMemo(() => parseDate(rangeStart), [rangeStart]);
  const endDate = useMemo(() => parseDate(rangeEnd), [rangeEnd]);
  // The provisional far end is kept SEPARATE from the committed one. Folding them together would
  // paint the hovered day as chosen, and a range that looks committed before you click is a range
  // people stop reading.
  const previewDate = useMemo(() => parseDate(previewEnd), [previewEnd]);
  const farEnd = endDate ?? previewDate;
  // `todayDate()` is called once per mount rather than held in a module constant: a constant is
  // evaluated at import, and a dashboard left open overnight would keep marking yesterday.
  const todayValue = useMemo(() => parseDate(today) ?? todayDate(), [today]);

  const weekStart = useMemo<WeekDay>(
    () => weekStartsOn ?? resolveWeekStart(locale),
    [locale, weekStartsOn],
  );
  const weekdays = useMemo(() => weekdayNames(locale, weekStart), [locale, weekStart]);

  const [focused, setFocused] = useState<CalendarDate>(() =>
    clampDate(
      parseDate(defaultFocusedDate) ?? selected ?? startDate ?? todayValue,
      minDate,
      maxDate,
    ),
  );

  const gridRef = useRef<HTMLTableElement | null>(null);
  // Set only by the keys and clicks that MOVE the roving focus. Month navigation deliberately does
  // not set it: the prev/next buttons must keep focus themselves, or one click of "previous month"
  // teleports the user into the grid and the second click never happens.
  const takeFocus = useRef(autoFocus);

  // useLayoutEffect, not useEffect: focus must land before paint, or the first keystroke after a
  // move goes to whatever had focus a frame ago.
  useLayoutEffect(() => {
    if (!takeFocus.current) return;
    takeFocus.current = false;
    gridRef.current?.querySelector<HTMLButtonElement>('[data-focused="true"]')?.focus();
  }, [focused]);

  /*
   * The live region. Empty until navigation actually changes the month, so opening the calendar
   * does not fire an announcement on top of the dialog's own — the grid is already labelled by the
   * heading, which a screen reader reads on entry.
   */
  const [announcement, setAnnouncement] = useState('');
  const lastMonth = useRef(`${String(focused.year)}-${String(focused.month)}`);
  useLayoutEffect(() => {
    const key = `${String(focused.year)}-${String(focused.month)}`;
    if (key === lastMonth.current) return;
    lastMonth.current = key;
    setAnnouncement(formatMonthLabel(focused, locale));
  }, [focused, locale]);

  const unavailable = useCallback(
    (date: CalendarDate): boolean => {
      if (!isInRange(date, minDate, maxDate)) return true;
      return isDateUnavailable?.(formatIso(date)) ?? false;
    },
    [isDateUnavailable, maxDate, minDate],
  );

  const move = useCallback(
    (next: CalendarDate) => {
      takeFocus.current = true;
      // Clamped rather than refused: pressing Down near `max` should land ON max, not do nothing.
      // An unavailable day inside the span is still reachable — see the note on the cells below.
      setFocused(clampDate(next, minDate, maxDate));
    },
    [maxDate, minDate],
  );

  const shiftMonth = useCallback(
    (delta: number) => {
      setFocused((current) => clampDate(addMonths(current, delta), minDate, maxDate));
    },
    [maxDate, minDate],
  );

  const onGridKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTableElement>) => {
      const { key, shiftKey } = event;
      let next: CalendarDate | null = null;

      if (key === 'ArrowLeft') next = addDays(focused, -1);
      else if (key === 'ArrowRight') next = addDays(focused, 1);
      else if (key === 'ArrowUp') next = addDays(focused, -7);
      else if (key === 'ArrowDown') next = addDays(focused, 7);
      else if (key === 'PageUp') next = shiftKey ? addYears(focused, -1) : addMonths(focused, -1);
      else if (key === 'PageDown') next = shiftKey ? addYears(focused, 1) : addMonths(focused, 1);
      else if (key === 'Home') next = startOfWeek(focused, weekStart);
      else if (key === 'End') next = addDays(startOfWeek(focused, weekStart), 6);

      if (!next) return;
      // Enter and Space are absent on purpose: each day is a real <button>, so the browser already
      // turns them into a click. Handling them here as well would select twice.
      event.preventDefault();
      move(next);
    },
    [focused, move, weekStart],
  );

  const choose = useCallback(
    (date: CalendarDate) => {
      if (unavailable(date)) return;
      takeFocus.current = true;
      setFocused(date);
      onSelect(formatIso(date));
    },
    [onSelect, unavailable],
  );

  /*
   * SIX ROWS, ALWAYS — even when a 28-day February starting on the first column needs four. A grid
   * that changes height between months makes the popover resize, which re-runs the anchoring and
   * makes the whole panel jump under the cursor mid-navigation. One extra row of adjacent-month
   * days is cheaper than that.
   */
  const weeks = useMemo(() => {
    const first = startOfWeek(startOfMonth(focused), weekStart);
    return Array.from({ length: ROWS }, (_, row) =>
      Array.from({ length: 7 }, (_, column) => addDays(first, row * 7 + column)),
    );
  }, [focused, weekStart]);

  // Normalised low-to-high, so a span drawn backwards (the user clicked the later day first) still
  // paints as one block instead of vanishing. The SWAP itself is DateRangePicker's decision; this
  // only refuses to render nonsense while it is being made.
  const ordered = startDate && farEnd ? compareDate(startDate, farEnd) <= 0 : true;
  const spanLow = startDate && farEnd ? (ordered ? startDate : farEnd) : null;
  const spanHigh = startDate && farEnd ? (ordered ? farEnd : startDate) : null;

  const atMinMonth = minDate !== null && compareDate(startOfMonth(focused), startOfMonth(minDate)) <= 0;
  const atMaxMonth = maxDate !== null && compareDate(startOfMonth(focused), startOfMonth(maxDate)) >= 0;

  return (
    <div className={[styles.calendar, className].filter(Boolean).join(' ')} style={style}>
      <div className={styles.header}>
        <button
          type="button"
          className={styles.nav}
          aria-label={text.previousMonth}
          // aria-disabled, not the native attribute: the button stays focusable and stays
          // announced, so a keyboard user learns the bound exists instead of tabbing past a hole.
          aria-disabled={atMinMonth || undefined}
          onClick={() => {
            if (!atMinMonth) shiftMonth(-1);
          }}
        >
          <Icon name="chevron_left" size="sm" />
        </button>

        {/* The grid's accessible name. A heading element rather than a bare div, so the month is
            reachable by heading navigation inside the dialog. */}
        <h2 id={titleId} className={styles.title}>
          {formatMonthLabel(focused, locale)}
        </h2>

        <button
          type="button"
          className={styles.nav}
          aria-label={text.nextMonth}
          aria-disabled={atMaxMonth || undefined}
          onClick={() => {
            if (!atMaxMonth) shiftMonth(1);
          }}
        >
          <Icon name="chevron_right" size="sm" />
        </button>
      </div>

      <table
        ref={gridRef}
        role="grid"
        className={styles.grid}
        aria-labelledby={titleId}
        onKeyDown={onGridKeyDown}
        onPointerLeave={() => onHoverDate?.(null)}
      >
        <thead>
          <tr>
            {weekdays.map((day) => (
              <th key={day.long} scope="col" role="columnheader" className={styles.weekday}>
                {/* The abbreviation is PAINTED and the full name is SPOKEN. `abbr` on <th> is the
                    classic answer and support for it is unreliable; two spans is not. */}
                <span aria-hidden="true">{day.short}</span>
                <span className={styles.srOnly}>{day.long}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => {
            const firstOfWeek = week[0];
            return (
              <tr key={firstOfWeek ? formatIso(firstOfWeek) : ''}>
                {week.map((date) => {
                  const iso = formatIso(date);
                  const outside = date.month !== focused.month || date.year !== focused.year;
                  const off = unavailable(date);
                  const isFocused = isSameDate(date, focused);
                  const isSelected =
                    isSameDate(date, selected) ||
                    isSameDate(date, startDate) ||
                    isSameDate(date, endDate);
                  const inSpan =
                    spanLow !== null &&
                    spanHigh !== null &&
                    compareDate(date, spanLow) >= 0 &&
                    compareDate(date, spanHigh) <= 0;

                  return (
                    <td
                      key={iso}
                      role="gridcell"
                      className={styles.cell}
                      // The selected state lives on the CELL, which is where the grid pattern puts
                      // it and where a screen reader reads it from as focus enters the button.
                      aria-selected={isSelected}
                      data-outside={outside || undefined}
                      data-in-span={inSpan || undefined}
                      data-span-start={(spanLow && isSameDate(date, spanLow)) || undefined}
                      data-span-end={(spanHigh && isSameDate(date, spanHigh)) || undefined}
                      data-preview={(endDate === null && previewDate !== null && inSpan) || undefined}
                    >
                      <button
                        type="button"
                        className={styles.day}
                        // Roving tabindex: exactly one day is in the tab order, so Tab leaves the
                        // grid and the arrow keys walk it. 42 tab stops is not a calendar.
                        tabIndex={isFocused ? 0 : -1}
                        // The full date, because "14" on its own is not a date. Grid position gives
                        // a sighted user the context; this gives everyone else the same context.
                        aria-label={formatDateLabel(date, locale)}
                        // Never the native attribute — an unavailable day stays focusable and stays
                        // announced, which is how a user discovers WHICH days are closed.
                        aria-disabled={off || undefined}
                        aria-current={isSameDate(date, todayValue) ? 'date' : undefined}
                        data-focused={isFocused || undefined}
                        data-today={isSameDate(date, todayValue) || undefined}
                        data-selected={isSelected || undefined}
                        data-unavailable={off || undefined}
                        onClick={() => choose(date)}
                        onPointerEnter={() => onHoverDate?.(iso)}
                      >
                        {date.day}
                      </button>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Polite and atomic. It carries the visible month and nothing else — see the docblock on why
          this is not the place for keyboard instructions. */}
      <span className={styles.srOnly} aria-live="polite" aria-atomic="true">
        {announcement}
      </span>
    </div>
  );
}
