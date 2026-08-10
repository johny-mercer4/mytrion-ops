import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MutableRefObject,
} from 'react';
import {
  displayHour,
  EMPTY_PARTS,
  formatTime,
  fromDisplayHour,
  parseTime,
  segmentRange,
  stepSegment,
  type DayPeriod,
  type TimeParts,
  type TimeSegmentKind,
} from './timeModel';

/*
 * The editing model behind TimePicker's segments: what a keystroke means, and what leaves through
 * `onChange`.
 *
 * It is a hook and its own file because TimePicker.tsx was over this repo's 600-line cap with it
 * inlined, and because the split falls on a real seam — everything here is "what does this key do
 * to four integers", while everything next door is composition and chrome. Nothing in here reads
 * the DOM except to move focus.
 */

/**
 * How long a half-typed segment keeps its first digit. Matches Select's type-ahead window, and for
 * the same reason: shorter, and "1" then "5" splits into two entries mid-keystroke.
 */
const TYPING_RESET_MS = 700;

/** PageUp/PageDown never moves less than this on a minute or second segment. */
const PAGE_GRAIN = 5;

export interface TimeSegmentsOptions {
  value: string | null;
  onChange: (value: string | null) => void;
  withSeconds: boolean;
  hour12: boolean;
  /** Minute grid. Arrows on the minute segment snap to it; typing is never constrained by it. */
  step: number | undefined;
  /** How many editable segments the layout produced. Bounds focus movement and auto-advance. */
  segmentCount: number;
  readOnly: boolean;
  disabled: boolean;
  /** The locale's AM/PM words, so their initials can be typed. */
  periodText: Record<DayPeriod, string>;
}

export interface TimeSegmentsApi {
  parts: TimeParts;
  /** The complete value, or `null` while any required unit is missing. */
  emitted: string | null;
  /** Always current, even inside a stale closure — the list machinery reads it on open. */
  emittedRef: MutableRefObject<string | null>;
  focusIndex: number;
  setFocusIndex: (index: number) => void;
  segRefs: MutableRefObject<Array<HTMLDivElement | null>>;
  focusSegment: (index: number) => void;
  /** What a numeric segment currently shows, in DISPLAY terms (1-12 for a 12-hour hour). */
  numericValue: (kind: TimeSegmentKind) => number | null;
  resetTyping: () => void;
  clear: () => void;
  /** Replaces the whole value at once. The increment listbox's commit path. */
  setValue: (next: string | null) => void;
  onSegmentKeyDown: (
    event: ReactKeyboardEvent<HTMLDivElement>,
    kind: TimeSegmentKind,
    index: number,
  ) => void;
}

export function useTimeSegments(options: TimeSegmentsOptions): TimeSegmentsApi {
  const { value, onChange, withSeconds, hour12, step, segmentCount, readOnly, disabled, periodText } =
    options;

  const [parts, setParts] = useState<TimeParts>(() => parseTime(value));
  const [focusIndex, setFocusIndex] = useState(0);

  const segRefs = useRef<Array<HTMLDivElement | null>>([]);
  /** Digits typed into the segment at `index` since the last commit or timeout. */
  const typing = useRef({ index: -1, buffer: '', at: 0 });
  /** The last string handed to `onChange`. Distinguishes our own echo from a real prop change. */
  const lastEmitted = useRef<string | null>(value);

  const emitted = formatTime(parts, withSeconds);
  const emittedRef = useRef<string | null>(emitted);
  emittedRef.current = emitted;

  /* ── Value in, value out ─────────────────────────────────────────────────── */

  // A `value` that is not our own echo replaces the draft. Comparing against what was last EMITTED —
  // rather than against the draft — is what lets a half-typed segment survive the re-render our own
  // `onChange(null)` causes, while a genuine change from the parent still wins.
  useEffect(() => {
    if (value === lastEmitted.current) return;
    lastEmitted.current = value;
    setParts(parseTime(value));
  }, [value]);

  const commitParts = useCallback(
    (next: TimeParts): void => {
      setParts(next);
      const out = formatTime(next, withSeconds);
      lastEmitted.current = out;
      if (out !== emittedRef.current) onChange(out);
    },
    [onChange, withSeconds],
  );

  const setValue = useCallback(
    (next: string | null): void => {
      setParts(parseTime(next));
      lastEmitted.current = next;
      if (next !== emittedRef.current) onChange(next);
    },
    [onChange],
  );

  const clear = useCallback((): void => {
    commitParts(EMPTY_PARTS);
  }, [commitParts]);

  /* ── Focus ───────────────────────────────────────────────────────────────── */

  const resetTyping = useCallback((): void => {
    typing.current = { index: -1, buffer: '', at: 0 };
  }, []);

  const focusSegment = useCallback(
    (index: number): void => {
      const clamped = Math.max(0, Math.min(segmentCount - 1, index));
      setFocusIndex(clamped);
      segRefs.current[clamped]?.focus();
    },
    [segmentCount],
  );

  /* ── Reading and writing one segment ─────────────────────────────────────── */

  const numericValue = useCallback(
    (kind: TimeSegmentKind): number | null => {
      if (kind === 'hour') return displayHour(parts.hour, hour12);
      if (kind === 'minute') return parts.minute;
      if (kind === 'second') return parts.second;
      return null;
    },
    [parts, hour12],
  );

  const setNumeric = useCallback(
    (kind: TimeSegmentKind, next: number | null): void => {
      if (kind === 'minute') return commitParts({ ...parts, minute: next });
      if (kind === 'second') return commitParts({ ...parts, second: next });
      // Clearing the hour keeps `period`, so an AM/PM the user already chose is not thrown away by
      // a Backspace on the unit next door.
      if (next === null) return commitParts({ ...parts, hour: null });
      const hour = fromDisplayHour(next, parts.period, hour12);
      return commitParts({ ...parts, hour, period: hour >= 12 ? 'pm' : 'am' });
    },
    [commitParts, parts, hour12],
  );

  const setPeriod = useCallback(
    (next: DayPeriod | null): void => {
      // With no hour yet, the choice is REMEMBERED rather than discarded — the user said PM, and
      // typing the hour afterwards must not silently mean AM.
      if (parts.hour === null || next === null) return commitParts({ ...parts, period: next });
      const base = parts.hour % 12;
      return commitParts({ ...parts, hour: next === 'pm' ? base + 12 : base, period: next });
    },
    [commitParts, parts],
  );

  /* ── Typing ──────────────────────────────────────────────────────────────── */

  const typeDigit = useCallback(
    (kind: TimeSegmentKind, index: number, digit: string): void => {
      const range = segmentRange(kind, hour12);
      const now = Date.now();
      const stale = typing.current.index !== index || now - typing.current.at > TYPING_RESET_MS;
      const buffer = stale ? '' : typing.current.buffer;

      // "1" then "5" is fifteen; "5" then "9" is fifty-nine; "6" then "1" restarts at one, because
      // 61 is not a minute. Restarting beats refusing — the second digit is what the user meant.
      let n = Number(`${buffer}${digit}`);
      if (n > range.max) n = Number(digit);
      if (n > range.max) return;

      // Two digits is every segment's whole width, so a second one always completes it. The
      // arithmetic covers the other case: 6 cannot take a second digit in a 0-59 segment, so it
      // completes on the first press rather than parking the user on a finished number.
      const complete = n * 10 > range.max || `${buffer}${digit}`.length >= 2;
      typing.current = { index, buffer: complete ? '' : String(n), at: now };

      // A typed 0 in a 12-hour hour means twelve. The segment's floor is 1, and refusing the
      // keystroke would leave the user pressing a key that does nothing.
      setNumeric(kind, kind === 'hour' && hour12 && n === 0 ? 12 : n);
      if (complete && index < segmentCount - 1) focusSegment(index + 1);
    },
    [focusSegment, hour12, segmentCount, setNumeric],
  );

  /* ── The keyboard map. Documented in full in TimePicker.tsx's docblock. ──── */

  const onSegmentKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>, kind: TimeSegmentKind, index: number): void => {
      if (disabled) return;

      // Movement is legal even when the value is not editable — a read-only field is still readable,
      // and a screen-reader user has to be able to walk it.
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        resetTyping();
        focusSegment(index + (event.key === 'ArrowRight' ? 1 : -1));
        return;
      }
      if (readOnly) return;

      const isPeriod = kind === 'dayPeriod';
      const range = segmentRange(kind, hour12);
      const grain = kind === 'minute' && step !== undefined && step > 1 ? step : 1;
      const bump = (delta: number, coarse: number): void => {
        if (isPeriod) setPeriod(parts.period === 'pm' ? 'am' : 'pm');
        else setNumeric(kind, stepSegment(numericValue(kind), delta, range, coarse));
      };

      switch (event.key) {
        case 'ArrowUp':
        case 'ArrowDown':
          event.preventDefault();
          resetTyping();
          bump(event.key === 'ArrowUp' ? 1 : -1, grain);
          return;
        case 'PageUp':
        case 'PageDown':
          event.preventDefault();
          resetTyping();
          // An hour has no coarser unit inside a time-of-day, so Page is Arrow there rather than a
          // jump of some invented size.
          bump(event.key === 'PageUp' ? 1 : -1, kind === 'hour' ? 1 : Math.max(PAGE_GRAIN, grain));
          return;
        case 'Home':
          event.preventDefault();
          resetTyping();
          if (isPeriod) setPeriod('am');
          else setNumeric(kind, range.min);
          return;
        case 'End':
          event.preventDefault();
          resetTyping();
          if (isPeriod) setPeriod('pm');
          else setNumeric(kind, range.max);
          return;
        case 'Backspace':
        case 'Delete':
          event.preventDefault();
          resetTyping();
          if (isPeriod) setPeriod(null);
          else setNumeric(kind, null);
          return;
        default:
          break;
      }

      // A modified key is a browser or OS command — copy, reload, switch tab. Never a digit.
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (isPeriod) {
        const key = event.key.toLowerCase();
        // The locale's own initial first, so the field works in a locale whose words are not
        // "AM"/"PM"; a/p stay bound because every keyboard in this building can reach them.
        if (key === periodText.am.charAt(0).toLowerCase() || key === 'a') {
          event.preventDefault();
          setPeriod('am');
        } else if (key === periodText.pm.charAt(0).toLowerCase() || key === 'p') {
          event.preventDefault();
          setPeriod('pm');
        }
        return;
      }

      if (event.key.length === 1 && event.key >= '0' && event.key <= '9') {
        event.preventDefault();
        typeDigit(kind, index, event.key);
      }
    },
    [
      disabled,
      readOnly,
      hour12,
      step,
      parts.period,
      periodText,
      focusSegment,
      numericValue,
      resetTyping,
      setNumeric,
      setPeriod,
      typeDigit,
    ],
  );

  return {
    parts,
    emitted,
    emittedRef,
    focusIndex,
    setFocusIndex,
    segRefs,
    focusSegment,
    numericValue,
    resetTyping,
    clear,
    setValue,
    onSegmentKeyDown,
  };
}
