import {
  forwardRef,
  useCallback,
  useId,
  useMemo,
  useRef,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { Icon } from '../Icon/Icon';
import { TimeList, type TimeIncrement } from './TimeList';
import {
  buildIncrements,
  buildLayout,
  dayPeriodLabels,
  displayHour,
  localeHour12,
  pad2,
  parseTime,
  segmentRange,
  timeKey,
  type TimeSegmentKind,
} from './timeModel';
import { useIncrementList } from './useIncrementList';
import { useTimeSegments } from './useTimeSegments';
import styles from './TimePicker.module.css';

/** See TimeList.tsx — the same one-liner, repeated rather than given a third module to live in. */
const cx = (...parts: Array<string | false | undefined>): string => parts.filter(Boolean).join(' ');

export type TimePickerSize = 'sm' | 'md';

export interface TimePickerLabels {
  hour?: string | undefined;
  minute?: string | undefined;
  second?: string | undefined;
  dayPeriod?: string | undefined;
  /** Announced as the value of a segment nobody has filled in yet. */
  empty?: string | undefined;
  clear?: string | undefined;
  openList?: string | undefined;
  /** Shown under the field when the value falls outside `min`/`max` and no `message` was given. */
  outOfRange?: string | undefined;
}

/**
 * The same keys, all present, none of them `undefined`.
 *
 * NOT `Required<TimePickerLabels>`: under `exactOptionalPropertyTypes` the `-?` modifier strips the
 * question mark but KEEPS an explicitly written `| undefined`, so `Required<>` of a src/ds props
 * type is still optional-valued and every use site then fails. `Record<keyof …, string>` states
 * what is actually true after merging.
 */
type TimeLabelText = Record<keyof TimePickerLabels, string>;

const DEFAULT_LABELS: TimeLabelText = {
  hour: 'Hour',
  minute: 'Minute',
  second: 'Second',
  dayPeriod: 'AM/PM',
  empty: 'Empty',
  clear: 'Clear time',
  openList: 'Choose a time',
  outOfRange: 'Outside the allowed range',
};

/**
 * Merged one key at a time rather than by spread. Every optional prop in src/ds is declared
 * `foo?: T | undefined` so callers can pass `foo={cond ? x : undefined}` — and spreading such an
 * object over the defaults widens every result back to `T | undefined`. This loop keeps the merged
 * shape total.
 */
function mergeLabels(labels: TimePickerLabels | undefined): TimeLabelText {
  const out = { ...DEFAULT_LABELS };
  if (!labels) return out;
  for (const key of Object.keys(out) as Array<keyof TimePickerLabels>) {
    const supplied = labels[key];
    if (supplied !== undefined) out[key] = supplied;
  }
  return out;
}

/** Placeholders. ASCII, and the same width as the digits they stand in for, so nothing reflows. */
const PLACEHOLDER: Readonly<Record<Exclude<TimeSegmentKind, 'dayPeriod'>, string>> = {
  hour: 'hh',
  minute: 'mm',
  second: 'ss',
};

export interface TimePickerProps {
  /**
   * `HH:mm` or `HH:mm:ss`, 24-hour, ALWAYS — regardless of what the field displays. `null` is
   * "no time". A string this component would not itself emit renders as an EMPTY field; it is never
   * guessed at.
   */
  value: string | null;
  /**
   * Fires with the complete value, or with `null` the moment the time stops being complete. It is
   * never called with a half-typed time: `09:__` is not a time, and a caller handed one would have
   * to re-implement this component's validity rules to notice.
   */
  onChange: (value: string | null) => void;
  /**
   * The accessible name — REQUIRED. A segmented field with no name announces as "group, spin
   * button", which describes the machinery and not the question.
   */
  label: string;
  /** Keeps the name for assistive tech, drops it from paint. For dense toolbars with a shared header. */
  labelHidden?: boolean | undefined;
  /** Adds the seconds segment AND switches the emitted value to `HH:mm:ss`. */
  withSeconds?: boolean | undefined;
  /**
   * Minute grid, in minutes. Arrow keys on the minute segment snap to it, and it is what makes the
   * increment listbox available. TYPING IS NOT CONSTRAINED BY IT — an operator who types 08:07 into
   * a field with a 15-minute step meant 08:07, and silently rewriting that is the same class of
   * error as guessing at a parse.
   */
  step?: number | undefined;
  /** 12- or 24-hour DISPLAY. Defaults to the locale's own convention. The value type never changes. */
  hourCycle?: 12 | 24 | undefined;
  /** BCP-47 tag, for segment order and the AM/PM words. Defaults to the runtime's locale. */
  locale?: string | undefined;
  /**
   * Bounds, as `HH:mm`. They do TWO things and deliberately not a third: they bound the increment
   * listbox, and a value outside them paints invalid. They do NOT clamp what you type.
   */
  min?: string | undefined;
  max?: string | undefined;
  /** Offer the increment listbox when `step` is set. Default `true`. */
  list?: boolean | undefined;
  /** `md` (32px) is the default; `sm` (26px) matches Button `sm`, for table rows and dense toolbars. */
  size?: TimePickerSize | undefined;
  disabled?: boolean | undefined;
  /** Readable and walkable by keyboard, not editable. Not the same thing as `disabled`. */
  readOnly?: boolean | undefined;
  /** Failed validation. Pair it with `message`; a red border alone never says what is wrong. */
  invalid?: boolean | undefined;
  /** Hint when valid, error when invalid. Wired into `aria-describedby` on the segment group. */
  message?: ReactNode | undefined;
  /** Renders a clear affordance whenever the field holds a value. */
  clearable?: boolean | undefined;
  /** Spans its container. Off by default: most fields here sit in a toolbar at their own width. */
  fullWidth?: boolean | undefined;
  /** Accessible names for the segments and affordances. One prop, so i18n is one object. */
  labels?: TimePickerLabels | undefined;
  id?: string | undefined;
  className?: string | undefined;
  style?: CSSProperties | undefined;
}

/**
 * The one time field. A SEGMENTED field — hour, minute, optional second, optional AM/PM — not a text
 * box you type a time into, and not a clock face you drag a hand around.
 *
 * WHY SEGMENTS, NOT A TEXT INPUT. An operator entering a known time TYPES it, forty times a shift.
 * A free-text box then has to guess what they meant, and every guess is a place a wrong number
 * enters a fuel-card ops record silently — `9.30`, `930`, `9:3`, `21:00pm`. Segments make the format
 * explicit before a key is pressed and make each unit independently arrow-able, so there is nothing
 * left to parse and nothing left to guess.
 *
 * WHY NOT A CLOCK DIAL. Material 3 offers one; it is rejected here on two counts. It cannot be
 * operated by keyboard in any way a keyboard user would recognise, and it spends a 250px square
 * expressing two numbers on a workspace whose whole argument is density.
 *
 * THE SECONDARY AFFORDANCE is the increment listbox, and it exists only when `step` is set — only
 * then is there a defensible short list to offer. It is the time-side equivalent of a date field's
 * calendar: a way to POINT at a common answer, never the primary way to give one. Above 288 rows it
 * withdraws itself, because a 1,440-row list is not a shortcut but a second, worse way to type a
 * number.
 *
 * KEYBOARD — the whole field is ONE tab stop. Arrows move between segments; Tab leaves.
 *   Left / Right        previous / next segment. No wrap: running off the end should stop, not
 *                       silently loop you back to the hour.
 *   Up / Down           +/- 1 on the focused segment, wrapping WITHIN that segment only — an hour
 *                       that flipped AM/PM under a held key is a surprise, and 23 -> 00 does not
 *                       mean "tomorrow" in a field with no date in it. On the minute segment with
 *                       `step` set it snaps to the grid (:07 -> :15, not :22). From empty, Up starts
 *                       at the segment's minimum and Down at its maximum — never at "now", which
 *                       would make one keystroke mean different things at different times of day.
 *   PageUp / PageDown   +/- 5 on minute and second (or `step`, when that is coarser). On hour and
 *                       AM/PM it is the same as Up/Down: inside a time-of-day an hour has no coarser
 *                       unit, and inventing one — six hours? a quarter day? — is a number nobody
 *                       asked for.
 *   Home / End          the segment's minimum / maximum; AM / PM on the day-period segment.
 *   0-9                 types into the focused segment and ADVANCES as soon as no further digit
 *                       could fit — "3" in a 24-hour hour is 03 and moves on, "1" waits for a
 *                       second digit.
 *   a / p               AM / PM on the day-period segment. The locale's own initials work too.
 *   Backspace / Delete  empties the focused segment. The value becomes `null`, because a time
 *                       missing a unit is not a time.
 *   Enter               NOT intercepted. It reaches the surrounding form, which is where a user who
 *                       has just finished typing a time expects it to go.
 *   Escape              NOT intercepted while the list is closed, so it still reaches the dialog or
 *                       drawer this field sits in.
 *
 * KEYBOARD — the increment listbox, once open (WAI-ARIA APG listbox):
 *   Up / Down · Home / End   move the highlight. No wrap.
 *   Enter / Space            take the highlighted time and close.
 *   Escape                   close AND restore the value held when the list opened.
 *   Tab                      close and KEEP. Escape reverts and Tab commits; if both did the same
 *                            thing, one of them would be lying.
 *   Focus RETURNS TO THE TRIGGER on close by every route, so the keyboard never lands back at the
 *   top of the document.
 *
 * FOCUS — the shell carries `data-focus-shell`, so the GLOBAL `:focus-within` rule paints the ring
 * on the field as a whole. The segments opt out of the global `:focus-visible` outline via
 * `data-focus-ring="none"` and take a filled highlight instead. That is not a second focus style: a
 * 2px ring at 2px offset around a 20px segment draws straight through the shell's own border — the
 * "accent ring inside the field" defect Input.tsx documents — and the shell ring already says the
 * field has focus. The segment highlight only ever says WHICH UNIT, the job a text caret does, and
 * it is two channels (a wash and an inset underline) rather than colour alone.
 *
 * NO ONE-TIME KEYBOARD-HELP ANNOUNCEMENT. The APG's date-picker example pushes a paragraph of key
 * instructions through a live region on every open. On a control an operator touches dozens of
 * times a day that is not help, it is an obstruction. The roles carry the affordance: a spin button
 * announces as a spin button, and a spin button's keys are already known.
 *
 * CONTROLLED, and honestly so. The segments hold a draft while a time is half-entered, but a `value`
 * that comes back different from what was last emitted REPLACES that draft. A parent that ignores
 * `onChange` will see its own value snap back, which is what "controlled" means.
 *
 * WHEN NOT TO USE IT
 * - A duration. "90 minutes" is not a time of day; this field wraps at 23:59 and can show an AM/PM
 *   segment, both of which are wrong for an elapsed span. Use a number field with an explicit unit.
 * - An instant. There is no date and no time zone here — the value is a wall-clock string. If what
 *   you mean is a moment on the timeline, the caller owns the date and the zone and this field
 *   contributes the time half.
 * - Picking from a set of AVAILABLE slots (a booking grid, an agent's free windows). That is a list
 *   of options where the taken ones have to be visibly taken; a spinner that happily arrows onto an
 *   unavailable minute is a control that lies.
 * - Native form submission. There is no hidden input; the value lives in React state. Submit it
 *   yourself.
 * - A stopwatch. `withSeconds` is for a scheduler that needs the precision, not for timing anything.
 */
export const TimePicker = forwardRef<HTMLDivElement, TimePickerProps>(function TimePicker(
  {
    value,
    onChange,
    label,
    labelHidden = false,
    withSeconds = false,
    step,
    hourCycle,
    locale,
    min,
    max,
    list = true,
    size = 'md',
    disabled = false,
    readOnly = false,
    invalid = false,
    message,
    clearable = false,
    fullWidth = false,
    labels,
    id,
    className,
    style,
  },
  ref,
) {
  const autoId = useId();
  const baseId = id ?? `tp${autoId}`;
  const labelId = `${baseId}-label`;
  const groupId = `${baseId}-group`;
  const messageId = `${baseId}-msg`;
  const listId = `${baseId}-list`;

  const text = useMemo(() => mergeLabels(labels), [labels]);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const hour12 = hourCycle === undefined ? localeHour12(locale) : hourCycle === 12;
  const layout = useMemo(
    () => buildLayout(locale, hour12, withSeconds),
    [locale, hour12, withSeconds],
  );
  const kinds = useMemo(
    () => layout.flatMap((part) => (part.type === 'segment' ? [part.kind] : [])),
    [layout],
  );
  const periodText = useMemo(() => dayPeriodLabels(locale), [locale]);

  const field = useTimeSegments({
    value,
    onChange,
    withSeconds,
    hour12,
    step,
    segmentCount: kinds.length,
    readOnly,
    disabled,
    periodText,
  });
  const { parts, emitted } = field;

  /** One value rendered through the SAME layout the field uses, so a list row and the field agree. */
  const renderTime = useCallback(
    (raw: string): string => {
      const p = parseTime(raw);
      return layout
        .map((part) => {
          if (part.type === 'literal') return part.text;
          if (part.kind === 'dayPeriod') return p.period === null ? '' : periodText[p.period];
          const n =
            part.kind === 'hour'
              ? displayHour(p.hour, hour12)
              : part.kind === 'minute'
                ? p.minute
                : p.second;
          return n === null ? '' : pad2(n);
        })
        .join('');
    },
    [layout, hour12, periodText],
  );

  const rows = useMemo<TimeIncrement[]>(() => {
    if (!list || step === undefined || readOnly || disabled) return [];
    return buildIncrements(step, min, max, withSeconds).map((v) => ({
      value: v,
      label: renderTime(v),
    }));
  }, [list, step, readOnly, disabled, min, max, withSeconds, renderTime]);

  const picker = useIncrementList({
    rows,
    currentRef: field.emittedRef,
    anchorRef: rootRef,
    onCommit: field.setValue,
  });
  const hasList = rows.length > 0;

  /* ── Derived paint state ─────────────────────────────────────────────────── */

  const outOfRange =
    emitted !== null &&
    ((min !== undefined && timeKey(emitted) < timeKey(min)) ||
      (max !== undefined && timeKey(emitted) > timeKey(max)));
  const isInvalid = invalid || outOfRange;
  // A caller's own message wins: it is more specific than anything this component can say.
  const shownMessage = message ?? (outOfRange ? text.outOfRange : null);
  const showClear = clearable && emitted !== null && !disabled && !readOnly;
  const activeSegment = Math.min(field.focusIndex, kinds.length - 1);

  const segmentLabel = (kind: TimeSegmentKind): string =>
    kind === 'hour'
      ? text.hour
      : kind === 'minute'
        ? text.minute
        : kind === 'second'
          ? text.second
          : text.dayPeriod;

  let segmentIndex = -1;

  return (
    <div
      ref={(node) => {
        rootRef.current = node;
        if (typeof ref === 'function') ref(node);
        else if (ref) ref.current = node;
      }}
      className={cx(styles.root, className)}
      style={style}
      data-size={size}
      data-full={fullWidth || undefined}
      data-state={picker.open ? 'open' : 'closed'}
      data-disabled={disabled || undefined}
    >
      {/* A <span>, not a <label>: `for` can only point at a form control, and the thing being named
          here is a GROUP of spin buttons. aria-labelledby on the group is the relationship that
          actually exists. */}
      <span id={labelId} className={cx(styles.label)} data-hidden={labelHidden || undefined}>
        {label}
      </span>

      {/* data-focus-shell is the contract, not a hint: global.css owns `:focus-within` here. */}
      <div
        className={cx(styles.shell)}
        data-focus-shell
        data-invalid={isInvalid || undefined}
        data-disabled={disabled || undefined}
        data-readonly={readOnly || undefined}
        onPointerDown={(event) => {
          // A press on the shell's own padding lands on the segment the keyboard was last on rather
          // than doing nothing — the whole box should behave like one field.
          if (event.target === event.currentTarget && !disabled) {
            event.preventDefault();
            field.focusSegment(activeSegment);
          }
        }}
      >
        {/* ONE clock glyph, never two: when the increment list exists its trigger carries the clock,
            so the leading decoration stands down. */}
        {hasList ? null : (
          <Icon name="schedule" size={size === 'sm' ? 'sm' : 'md'} className={cx(styles.leading)} />
        )}

        <div
          id={groupId}
          role="group"
          className={cx(styles.segments)}
          aria-labelledby={labelId}
          aria-describedby={shownMessage === null ? undefined : messageId}
        >
          {layout.map((part, i) => {
            if (part.type === 'literal') {
              return (
                <span key={`lit-${String(i)}`} className={cx(styles.literal)} aria-hidden="true">
                  {part.text}
                </span>
              );
            }

            segmentIndex += 1;
            const index = segmentIndex;
            const kind = part.kind;
            const isPeriod = kind === 'dayPeriod';
            const n = field.numericValue(kind);
            const range = segmentRange(kind, hour12);
            const empty = isPeriod ? parts.period === null : n === null;
            const shown = isPeriod
              ? periodText[parts.period ?? 'am']
              : n === null
                ? PLACEHOLDER[kind]
                : pad2(n);

            return (
              <div
                key={kind}
                ref={(node) => {
                  field.segRefs.current[index] = node;
                }}
                className={cx(styles.segment)}
                role="spinbutton"
                // Roving tabindex: ONE stop for the whole field. Tab is how you LEAVE a control, not
                // how you cross it — four stops to get past a time is four too many.
                tabIndex={disabled ? -1 : index === activeSegment ? 0 : -1}
                // Opts out of the GLOBAL :focus-visible outline — see the FOCUS note in the docblock.
                data-focus-ring="none"
                data-kind={kind}
                data-empty={empty || undefined}
                aria-label={segmentLabel(kind)}
                aria-valuemin={isPeriod ? 0 : range.min}
                aria-valuemax={isPeriod ? 1 : range.max}
                aria-valuenow={
                  empty ? undefined : isPeriod ? (parts.period === 'pm' ? 1 : 0) : (n ?? undefined)
                }
                // Digits alone announce as a bare number and a placeholder announces as nothing at
                // all. valuetext is what makes both "Empty" and "09" sayable.
                aria-valuetext={empty ? text.empty : shown}
                aria-invalid={isInvalid || undefined}
                aria-disabled={disabled || undefined}
                aria-readonly={readOnly || undefined}
                onFocus={() => field.setFocusIndex(index)}
                onBlur={field.resetTyping}
                onPointerDown={(event) => {
                  if (disabled) return;
                  // preventDefault stops a drag from selecting across two segments, which is how you
                  // end up copying "09:4" out of a field.
                  event.preventDefault();
                  field.focusSegment(index);
                }}
                onKeyDown={(event) => field.onSegmentKeyDown(event, kind, index)}
              >
                {shown}
              </div>
            );
          })}
        </div>

        {showClear ? (
          <button
            type="button"
            className={cx(styles.affordance)}
            aria-label={text.clear}
            aria-controls={groupId}
            onClick={() => {
              field.clear();
              // Focus goes back into the field, not to a button that is about to vanish from under
              // the cursor and drop a keyboard user at the top of the page.
              field.focusSegment(0);
            }}
          >
            <Icon name="close" size="sm" />
          </button>
        ) : null}

        {hasList ? (
          <button
            ref={picker.triggerRef}
            type="button"
            className={cx(styles.affordance)}
            aria-label={text.openList}
            aria-haspopup="listbox"
            aria-expanded={picker.open}
            // Only while open: the listbox is unmounted when closed, and pointing aria-controls at
            // an id that is not in the document is a dangling reference some AT reports as an error.
            aria-controls={picker.open ? listId : undefined}
            disabled={disabled}
            onClick={() => {
              if (picker.open) picker.closeList(false);
              else picker.openList();
            }}
          >
            <Icon name="schedule" size="sm" />
          </button>
        ) : null}
      </div>

      {shownMessage === null ? null : (
        <p id={messageId} className={cx(styles.message)} data-invalid={isInvalid || undefined}>
          {/* A glyph, not just a red tint — meaning is never carried by colour alone. */}
          {isInvalid ? <Icon name="error" size="sm" className={cx(styles.messageIcon)} /> : null}
          <span>{shownMessage}</span>
        </p>
      )}

      {picker.open ? (
        <TimeList
          baseId={baseId}
          listId={listId}
          labelId={labelId}
          rows={rows}
          activeIndex={picker.activeIndex}
          selected={emitted}
          placement={picker.placement}
          height={picker.height}
          listRef={picker.listRef}
          onChoose={(v) => {
            field.setValue(v);
            picker.closeList(false);
          }}
          onHover={picker.setActiveIndex}
          onKeyDown={picker.onListKeyDown}
        />
      ) : null}
    </div>
  );
});
