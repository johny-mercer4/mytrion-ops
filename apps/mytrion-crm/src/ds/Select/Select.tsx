import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Icon } from '../Icon/Icon';
import { buildVisible, resolveSelected, sameValues, type SelectItem, type SelectOption } from './selectModel';
import { SelectPopup } from './SelectPopup';
import styles from './Select.module.css';

export type { SelectOption, SelectOptionGroup, SelectItem } from './selectModel';

export type SelectSize = 'sm' | 'md';

interface SelectBaseProps {
  options: readonly SelectItem[];
  /**
   * The accessible name — REQUIRED, because a combobox without one is announced as "combo box" and
   * nothing else. Rendered visibly above the field unless `labelHidden`.
   */
  label: string;
  /** Keeps the name for assistive tech, drops it from paint. For dense toolbars with a shared header. */
  labelHidden?: boolean;
  /** Shown when nothing is selected. Say what to pick — "All owners" — not "Select…". */
  placeholder?: string;
  /**
   * Typing filters the list. ON by default: this component exists because seven bespoke pickers each
   * rebuilt filtering. Turn it OFF for short fixed lists (a status of five values), where a text
   * caret implies a freedom the control does not have.
   */
  searchable?: boolean;
  /** Adds a clear affordance. Only offer it where "no value" is a legal state for the field. */
  clearable?: boolean;
  disabled?: boolean;
  /** Failed validation. Pair it with `message` — a red border alone never says what is wrong. */
  invalid?: boolean;
  /** Options are still arriving. Shows a busy row instead of claiming the list is empty. */
  loading?: boolean;
  /** `md` (32px) is the default; `sm` (26px) matches Button `sm`, for table rows and dense toolbars. */
  size?: SelectSize;
  /** Shown when there are no options AT ALL — distinct from "your search matched nothing". */
  emptyLabel?: string;
  /** Help or error text under the field. Wired through `aria-describedby`. */
  message?: string;
  className?: string;
  style?: CSSProperties;
}

interface SelectSingleProps extends SelectBaseProps {
  multiple?: false;
  /** `null` is "nothing selected". An empty string is a value, not an absence. */
  value: string | null;
  onChange: (value: string | null) => void;
}

interface SelectMultipleProps extends SelectBaseProps {
  multiple: true;
  value: readonly string[];
  onChange: (values: string[]) => void;
}

export type SelectProps = SelectSingleProps | SelectMultipleProps;

/**
 * How long a type-ahead buffer survives between keystrokes. 700ms is what a native `<select>` uses;
 * any shorter and "Ma" + "ra" splits into two searches in the middle of a name.
 */
const TYPEAHEAD_RESET_MS = 700;
/** Popup geometry in px. `POPUP_MAX_H` mirrors `--select-popup-h` in the stylesheet. */
const POPUP_MAX_H = 288;
const POPUP_MIN_H = 152;
const VIEWPORT_GAP = 8;

/**
 * Class-list join. A CSS-module lookup is `string | undefined` under `noUncheckedIndexedAccess`, and
 * `Icon`'s `className` is an exact optional — so every module class handed to a child goes through
 * here rather than through a cast at each call site.
 */
const cx = (...parts: Array<string | false | undefined>): string => parts.filter(Boolean).join(' ');

/**
 * The one Select.
 *
 * Replaces SEVEN bespoke pickers (`SearchableSelect`, `HrSelect`, `PersonPicker`, `LeadStatusPicker`,
 * `ViewAsPicker`, `ActAsPicker`, `TestAsPicker`), each of which re-derived filtering, arrow-key
 * movement, click-outside and "do not open off the bottom of the screen" with its own bugs.
 *
 * It is NOT a styled `<select>`. The native control renders its list as OS chrome — a white system
 * popup on macOS — which no stylesheet can reach inside, so a dark toolbar opened a bright panel
 * belonging to no part of this app.
 *
 * MODES — one component, because they are one behaviour with different arithmetic:
 *   single (default) · `searchable` (default ON) · `multiple`, which renders removable chips.
 *
 * KEYBOARD
 *   Down / Up          open when closed; else move the highlight. NO WRAP: on a long filtered list,
 *                      jumping from the last row back to the first loses the user's place. Home/End
 *                      is the deliberate way to cross the list.
 *   Alt+Down / Alt+Up  open without moving the highlight / close.
 *   Home / End         first / last selectable option.
 *   Enter              open when closed; else choose the highlighted option. Single closes; multi
 *                      stays open — you came here to pick several — and resets the filter.
 *   Escape             close AND RESTORE the value held when the popup opened. That is the undo for
 *                      a multi-select: five wrong toggles are one Escape away. IGNORED when closed,
 *                      so Escape still reaches the dialog or drawer above.
 *   Tab                close and COMMIT. Escape reverts and Tab keeps; if both did the same thing,
 *                      one of them would be lying.
 *   Backspace          on an EMPTY input: removes the last chip (multi), or clears (single +
 *                      `clearable`). This is the keyboard route to the ✕ buttons, which are
 *                      deliberately not tab stops — twenty chips must not mean twenty tab stops.
 *   Space              chooses, ONLY when `searchable` is off. When it is on, space is a character.
 *   type-ahead         filters when `searchable`; jumps to the first matching label when it is not.
 *
 * FOCUS never leaves the input. The highlight moves via `aria-activedescendant`, not roving
 * tabindex — which is what makes this safe inside a modal: nothing has to negotiate with the
 * dialog's focus trap, and the caret stays put while the list is being driven.
 *
 * POSITIONING is deliberately naive and has no library: absolutely positioned against the field,
 * below it, flipped above when the space below is short and the space above is better. The cost is
 * stated rather than hidden — an ancestor with `overflow: hidden` clips the popup, and an ancestor
 * that scrolls independently of the page drags it out of alignment. Keep the field in normal
 * document flow, or reach for a portal-based component instead of patching this one.
 *
 * WHEN NOT TO USE IT
 * - Two or three mutually exclusive options that all fit on screen. That is a radio group or a
 *   segmented control, where every choice is readable without a click.
 * - A text field that merely SUGGESTS completions. This control cannot produce a value outside
 *   `options`; an autocomplete can, and users expect it to.
 * - Server-side search over thousands of rows. Filtering here is synchronous and client-side. Feed
 *   it a page of results and own the query yourself, or use a dedicated async picker.
 * - Actions. A list of things that HAPPEN when clicked is a menu, not a listbox: a listbox holds a
 *   value, and assistive tech announces it as one.
 * - Native form submission. There is no hidden input; the value lives in React state.
 */
export const Select = forwardRef<HTMLInputElement, SelectProps>(function Select(props, ref) {
  const {
    options,
    label,
    labelHidden = false,
    placeholder = 'Select…',
    searchable = true,
    clearable = false,
    disabled = false,
    invalid = false,
    loading = false,
    size = 'md',
    emptyLabel = 'No options',
    message,
    className,
    style,
  } = props;

  const multiple = props.multiple === true;

  const baseId = useId();
  const inputId = `${baseId}-input`;
  const labelId = `${baseId}-label`;
  const listId = `${baseId}-list`;
  const messageId = `${baseId}-message`;

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const [placement, setPlacement] = useState<'bottom' | 'top'>('bottom');
  const [popupH, setPopupH] = useState(POPUP_MAX_H);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const typeahead = useRef({ buffer: '', at: 0 });
  /** The value at the moment the popup opened — what Escape restores. */
  const snapshot = useRef<readonly string[]>([]);
  /** Did the highlight last move by key or by pointer? Only a key move may scroll the list. */
  const navByKey = useRef(false);

  // Normalised to an array so single and multi share ONE code path. The union is re-entered only in
  // `emit`, the single place that knows which shape the caller wants back.
  const selected = useMemo<readonly string[]>(
    () => (props.multiple ? props.value : props.value == null ? [] : [props.value]),
    [props.multiple, props.value],
  );
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  const emit = useCallback(
    (next: readonly string[]): void => {
      if (props.multiple) props.onChange([...next]);
      else props.onChange(next[0] ?? null);
    },
    [props.multiple, props.onChange],
  );

  const { groups, flat } = useMemo(() => buildVisible(options, query, baseId), [options, query, baseId]);
  const selectedOptions = useMemo(() => resolveSelected(options, selected), [options, selected]);

  const firstSelectable = useCallback(
    (from: number, step: number): number => {
      for (let i = from; i >= 0 && i < flat.length; i += step) if (!flat[i]?.disabled) return i;
      return -1;
    },
    [flat],
  );

  /* ── Open / close ───────────────────────────────────────────────────────── */
  const openPopup = useCallback(
    (byKey: boolean): void => {
      if (disabled) return;
      snapshot.current = selectedRef.current;
      navByKey.current = byKey;
      setOpen(true);
    },
    [disabled],
  );

  const closePopup = useCallback(
    (restore: boolean): void => {
      setOpen(false);
      setQuery('');
      setActiveIndex(-1);
      typeahead.current = { buffer: '', at: 0 };
      if (restore && !sameValues(snapshot.current, selectedRef.current)) emit(snapshot.current);
    },
    [emit],
  );

  // Held in a ref so the document listener below subscribes once per open, rather than on every
  // render — `closePopup`'s identity changes with the caller's `onChange`, which is usually inline.
  const commitClose = useRef<() => void>(() => undefined);
  useEffect(() => {
    commitClose.current = () => closePopup(false);
  });

  // An outside press COMMITS, matching Tab. `pointerdown` and not `click`, because it has to fire
  // before the focus change repaints — otherwise the panel is stranded over the next control.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: PointerEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) commitClose.current();
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  // Highlight the CURRENT selection on open, so Enter repeats the existing value instead of
  // silently replacing it with row one.
  useEffect(() => {
    if (!open) return;
    const at = flat.findIndex((o) => selectedRef.current.includes(o.value));
    setActiveIndex(at >= 0 ? at : firstSelectable(0, 1));
    // Deliberately keyed to `open` alone: re-running on `flat` would fight the filter reset below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Filtering invalidates the highlight. Without this, Enter picks a row the user can no longer see.
  useEffect(() => {
    if (!open) return;
    navByKey.current = true;
    setActiveIndex(firstSelectable(0, 1));
  }, [query, open, firstSelectable]);

  /* ── Placement ───────────────────────────────────────────────────────────────
     Anchor below; flip above only when below is genuinely short AND above is roomier — a popup that
     flips on every few pixels of scroll is worse than one that is occasionally cramped. `true` on
     the scroll listener catches scrolling ANCESTORS, not just the page. */
  useLayoutEffect(() => {
    if (!open) return undefined;
    const measure = (): void => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return;
      const below = window.innerHeight - rect.bottom - VIEWPORT_GAP;
      const above = rect.top - VIEWPORT_GAP;
      const up = below < POPUP_MIN_H && above > below;
      setPlacement(up ? 'top' : 'bottom');
      setPopupH(Math.max(POPUP_MIN_H, Math.min(POPUP_MAX_H, up ? above : below)));
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [open]);

  // Keep the highlight on screen — but ONLY when a key moved it. Doing this on pointer movement
  // scrolls the list out from under the cursor, which then hovers a different row, which scrolls…
  useEffect(() => {
    if (!open || !navByKey.current) return;
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  /* ── Choosing ───────────────────────────────────────────────────────────── */
  const choose = useCallback(
    (option: SelectOption): void => {
      if (option.disabled) return;
      if (multiple) {
        const current = selectedRef.current;
        emit(
          current.includes(option.value)
            ? current.filter((v) => v !== option.value)
            : [...current, option.value],
        );
        // Reset the filter so the next pick starts from the whole list. Leaving a stale query up is
        // how users conclude the remaining options were removed.
        setQuery('');
      } else {
        emit([option.value]);
        setOpen(false);
        setQuery('');
        setActiveIndex(-1);
      }
      inputRef.current?.focus();
    },
    [multiple, emit],
  );

  const move = useCallback(
    (delta: number): void => {
      navByKey.current = true;
      const from = activeIndex < 0 ? (delta > 0 ? 0 : flat.length - 1) : activeIndex + delta;
      const next = firstSelectable(Math.max(0, Math.min(flat.length - 1, from)), delta > 0 ? 1 : -1);
      if (next >= 0) setActiveIndex(next);
    },
    [activeIndex, flat.length, firstSelectable],
  );

  const runTypeahead = useCallback(
    (char: string): void => {
      const now = Date.now();
      const stale = now - typeahead.current.at > TYPEAHEAD_RESET_MS;
      const buffer = stale ? char : typeahead.current.buffer + char;
      typeahead.current = { buffer, at: now };
      const at = flat.findIndex((o) => !o.disabled && o.label.toLowerCase().startsWith(buffer));
      if (at >= 0) {
        navByKey.current = true;
        setActiveIndex(at);
      }
    },
    [flat],
  );

  /* ── Keyboard ───────────────────────────────────────────────────────────── */
  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (disabled) return;
    const active = activeIndex >= 0 ? flat[activeIndex] : undefined;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (!open) openPopup(!e.altKey);
        else if (!e.altKey) move(1);
        return;
      case 'ArrowUp':
        e.preventDefault();
        if (open && e.altKey) closePopup(false);
        else if (!open) openPopup(true);
        else move(-1);
        return;
      case 'Home':
        if (!open) return;
        e.preventDefault();
        navByKey.current = true;
        setActiveIndex(firstSelectable(0, 1));
        return;
      case 'End':
        if (!open) return;
        e.preventDefault();
        navByKey.current = true;
        setActiveIndex(firstSelectable(flat.length - 1, -1));
        return;
      case 'Enter':
        // Always swallowed: an Enter that escapes into a surrounding form submits it, which is the
        // single most reported bug across the pickers this component replaces.
        e.preventDefault();
        if (!open) openPopup(true);
        else if (active) choose(active);
        return;
      case 'Escape':
        // Only when open. A closed Select must let Escape through to the dialog above it.
        if (!open) return;
        e.preventDefault();
        e.stopPropagation();
        closePopup(true);
        inputRef.current?.focus();
        return;
      case 'Tab':
        // No preventDefault — Tab must move focus. It COMMITS, unlike Escape.
        if (open) closePopup(false);
        return;
      case 'Backspace':
        if (query !== '' || selected.length === 0) return;
        e.preventDefault();
        if (multiple) emit(selected.slice(0, -1));
        else if (clearable) emit([]);
        return;
      case ' ':
        // A character while the user is typing a filter; a chooser when there is nothing to type in.
        if (searchable) return;
        e.preventDefault();
        if (!open) openPopup(true);
        else if (active) choose(active);
        return;
      default:
        break;
    }

    // Type-ahead for the non-searchable mode, where a readOnly input fires no change event at all.
    if (!searchable && e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      if (!open) openPopup(true);
      runTypeahead(e.key.toLowerCase());
    }
  };

  /* ── Pointer ────────────────────────────────────────────────────────────── */
  const onShellPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (disabled) return;
    // Clicking INTO an open search field repositions the caret; it must not close the popup.
    // Anywhere else on the shell is a disclosure toggle.
    if (searchable && open && e.target === inputRef.current) return;
    e.preventDefault(); // keeps focus on the input across the press
    inputRef.current?.focus();
    if (open) closePopup(false);
    else openPopup(false);
  };

  const activeId = open && activeIndex >= 0 ? `${baseId}-opt-${activeIndex}` : undefined;
  const singleLabel = multiple ? '' : (selectedOptions[0]?.label ?? '');
  const inputValue = searchable && open ? query : singleLabel;
  // While filtering, the placeholder carries the CURRENT selection: the input's own text has been
  // replaced by the query, and a user who cannot see what they already chose re-picks it blind.
  // With chips up there is nothing to restate — they already say it, in full.
  const inputPlaceholder =
    multiple && selected.length > 0 ? '' : open && searchable ? singleLabel || placeholder : placeholder;

  return (
    <div
      ref={rootRef}
      className={cx(styles.root, className)}
      style={style}
      data-size={size}
      data-state={open ? 'open' : 'closed'}
      data-multiple={multiple || undefined}
      data-invalid={invalid || undefined}
      data-disabled={disabled || undefined}
      data-loading={loading || undefined}
    >
      <label id={labelId} htmlFor={inputId} className={cx(styles.label)} data-hidden={labelHidden || undefined}>
        {label}
      </label>

      {/* data-focus-shell hands the focus ring to the GLOBAL rule: the bare input inside must not
          paint its own, or the field gets a second border drawn inside the first. */}
      <div className={cx(styles.shell)} data-focus-shell onPointerDown={onShellPointerDown}>
        <div className={cx(styles.values)}>
          {multiple
            ? selectedOptions.map((o) => (
                <span key={o.value} className={cx(styles.chip)}>
                  <span className={cx(styles.chipLabel)}>{o.label}</span>
                  {/* NOT a tab stop, by decision: twenty chips would put twenty tab stops between
                      this field and the next one. The same result is fully keyboard-reachable —
                      Backspace from the empty input, or toggling the option off in the list. */}
                  <button
                    type="button"
                    className={cx(styles.chipRemove)}
                    tabIndex={-1}
                    aria-label={`Remove ${o.label}`}
                    disabled={disabled}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => {
                      emit(selected.filter((v) => v !== o.value));
                      inputRef.current?.focus();
                    }}
                  >
                    <Icon name="close" size="sm" />
                  </button>
                </span>
              ))
            : null}

          <input
            ref={(node) => {
              inputRef.current = node;
              if (typeof ref === 'function') ref(node);
              // React types `RefObject.current` as readonly, but a ref passed to forwardRef is the
              // very object React writes to itself; assigning is the documented merge and the cast
              // only restates what `useRef` already produced.
              else if (ref) (ref as MutableRefObject<HTMLInputElement | null>).current = node;
            }}
            id={inputId}
            className={cx(styles.input)}
            // ONE focusable element in both modes. When the list is not searchable the input goes
            // readOnly rather than becoming a <button>, so the keyboard map, the chips and
            // aria-activedescendant have a single implementation instead of two that drift.
            readOnly={!searchable}
            data-readonly={!searchable || undefined}
            role="combobox"
            aria-expanded={open}
            // Only while open: the listbox is unmounted when closed, and pointing aria-controls at
            // an id that is not in the document is a dangling reference some AT reports as an error.
            aria-controls={open ? listId : undefined}
            aria-autocomplete={searchable ? 'list' : 'none'}
            aria-activedescendant={activeId}
            aria-labelledby={labelId}
            aria-describedby={message ? messageId : undefined}
            aria-invalid={invalid || undefined}
            aria-busy={loading || undefined}
            disabled={disabled}
            value={inputValue}
            placeholder={inputPlaceholder}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => {
              if (!open) openPopup(true);
              setQuery(e.target.value);
            }}
            onKeyDown={onKeyDown}
          />
        </div>

        <div className={cx(styles.trailing)}>
          {clearable && selected.length > 0 && !disabled ? (
            <button
              type="button"
              className={cx(styles.clear)}
              tabIndex={-1}
              aria-label={`Clear ${label}`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => {
                emit([]);
                inputRef.current?.focus();
              }}
            >
              <Icon name="close" size="sm" />
            </button>
          ) : null}
          {loading ? (
            <span className={cx(styles.spinner)} aria-hidden="true" />
          ) : (
            // The chevron does NOT rotate when open. A persistent rotate is a persistent transform,
            // which promotes a composited layer — the defect class this app has already shipped.
            // `aria-expanded` carries the state, and the popup itself is the visual signal.
            <Icon name="expand_more" size="sm" className={cx(styles.chevron)} />
          )}
        </div>
      </div>

      {message ? (
        <p id={messageId} className={cx(styles.message)}>
          {/* A glyph, not just a red tint — meaning is never carried by colour alone. */}
          {invalid ? <Icon name="error" size="sm" /> : null}
          {message}
        </p>
      ) : null}

      {open ? (
        <SelectPopup
          baseId={baseId}
          listId={listId}
          labelId={labelId}
          groups={groups}
          activeIndex={activeIndex}
          selected={selected}
          multiple={multiple}
          loading={loading}
          query={query}
          emptyLabel={emptyLabel}
          placement={placement}
          height={popupH}
          listRef={listRef}
          onChoose={choose}
          onHover={(index) => {
            navByKey.current = false;
            setActiveIndex(index);
          }}
        />
      ) : null}
    </div>
  );
});
