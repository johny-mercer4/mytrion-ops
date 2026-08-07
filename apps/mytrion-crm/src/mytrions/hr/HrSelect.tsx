/**
 * A select we own, because the native one is not themeable.
 *
 * `<select>` renders its option list as OS chrome — a white system popup on macOS — so a dark HR toolbar
 * opened a bright panel that belonged to no part of this app. No amount of CSS reaches inside it.
 *
 * This is the ARIA "select-only combobox" pattern: focus never leaves the trigger, and the active option
 * is pointed at with `aria-activedescendant`. Keeping focus on the button is what makes this safe to drop
 * into a modal later — nothing has to negotiate with the dialog's focus trap.
 *
 * What a native select gives you for free and therefore has to be rebuilt here: arrow-key movement,
 * Home/End, type-ahead, Escape, click-outside, scrolling the active option into view, and not opening off
 * the bottom of the screen.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

export interface HrSelectOption {
  value: string;
  label: string;
}

/** How long a type-ahead buffer survives between keystrokes, matching native select behaviour. */
const TYPEAHEAD_RESET_MS = 700;
/** Never taller than this; the department list is 23 rows and a full-height popup is unusable. */
const MAX_POPUP_H = 288;

export function HrSelect({
  value,
  options,
  onChange,
  label,
  placeholder = 'Select…',
}: {
  value: string;
  options: readonly HrSelectOption[];
  onChange: (next: string) => void;
  /** Accessible name. Rendered visually hidden, so the control needs no visible label beside it. */
  label: string;
  placeholder?: string;
}) {
  const id = useId();
  const listId = `${id}-list`;
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [dropUp, setDropUp] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const typeahead = useRef({ buffer: '', at: 0 });

  const selectedIndex = useMemo(
    () => options.findIndex((option) => option.value === value),
    [options, value],
  );
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;

  const close = useCallback((): void => {
    setOpen(false);
    setActiveIndex(-1);
  }, []);

  /** Open with the current selection active, so arrows continue from where the value already is. */
  const openList = useCallback((): void => {
    if (options.length === 0) return;
    // Decide the direction BEFORE painting: `.hr-root` is a scroll container, so a popup that runs past
    // its bottom edge is clipped, not scrolled to.
    const box = buttonRef.current?.getBoundingClientRect();
    if (box) {
      const below = window.innerHeight - box.bottom;
      setDropUp(below < Math.min(MAX_POPUP_H, options.length * 32 + 12) && box.top > below);
    }
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
    setOpen(true);
  }, [options.length, selectedIndex]);

  const commit = useCallback(
    (index: number): void => {
      const option = options[index];
      if (option) onChange(option.value);
      close();
      buttonRef.current?.focus();
    },
    [options, onChange, close],
  );

  // Click (or tap) anywhere else dismisses. `pointerdown`, not `click`, so the list closes on press
  // rather than release — a click that lands on another control should not also be eaten by this one.
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (ev: PointerEvent): void => {
      if (!rootRef.current?.contains(ev.target as Node)) close();
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open, close]);

  // Keep the active option visible while arrowing through a list taller than the popup.
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    listRef.current?.children[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex]);

  const move = (delta: number): void => {
    setActiveIndex((prev) => {
      const from = prev < 0 ? selectedIndex : prev;
      const next = from + delta;
      // Clamp rather than wrap: a wrapping list makes "am I at the end?" unanswerable without counting.
      return Math.max(0, Math.min(options.length - 1, next < 0 ? 0 : next));
    });
  };

  const onKeyDown = (ev: React.KeyboardEvent): void => {
    switch (ev.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        ev.preventDefault();
        if (!open) openList();
        else move(ev.key === 'ArrowDown' ? 1 : -1);
        return;
      }
      case 'Home':
      case 'End': {
        if (!open) return;
        ev.preventDefault();
        setActiveIndex(ev.key === 'Home' ? 0 : options.length - 1);
        return;
      }
      case 'Enter':
      case ' ': {
        ev.preventDefault();
        if (!open) openList();
        else if (activeIndex >= 0) commit(activeIndex);
        return;
      }
      case 'Escape': {
        if (!open) return;
        ev.preventDefault();
        close();
        return;
      }
      case 'Tab': {
        // Let focus leave, but never leave the list hanging open behind it.
        if (open) close();
        return;
      }
      default:
        break;
    }

    // Type-ahead: printable characters jump to the first option starting with what was typed.
    if (ev.key.length !== 1 || ev.altKey || ev.ctrlKey || ev.metaKey) return;
    const now = Date.now();
    const buffer =
      now - typeahead.current.at > TYPEAHEAD_RESET_MS
        ? ev.key.toLowerCase()
        : typeahead.current.buffer + ev.key.toLowerCase();
    typeahead.current = { buffer, at: now };
    const hit = options.findIndex((option) => option.label.toLowerCase().startsWith(buffer));
    if (hit < 0) return;
    ev.preventDefault();
    if (open) setActiveIndex(hit);
    else commit(hit);
  };

  return (
    <div className="hr-cselect" ref={rootRef} data-open={open ? 'true' : undefined}>
      <span className="hr-sr" id={`${id}-label`}>
        {label}
      </span>
      <button
        ref={buttonRef}
        type="button"
        role="combobox"
        aria-controls={listId}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-labelledby={`${id}-label`}
        {...(open && activeIndex >= 0 ? { 'aria-activedescendant': `${id}-opt-${activeIndex}` } : {})}
        className="hr-cselect-btn"
        onClick={() => (open ? close() : openList())}
        onKeyDown={onKeyDown}
      >
        <span className={`hr-cselect-value${selected ? '' : ' is-placeholder'}`}>
          {selected?.label ?? placeholder}
        </span>
        <ChevronDown size={14} className="hr-cselect-caret" aria-hidden="true" />
      </button>

      {open ? (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-labelledby={`${id}-label`}
          className={`hr-cselect-list${dropUp ? ' is-up' : ''}`}
        >
          {options.map((option, index) => {
            const isSelected = option.value === value;
            return (
              <li
                key={option.value}
                id={`${id}-opt-${index}`}
                role="option"
                aria-selected={isSelected}
                className={`hr-cselect-opt${index === activeIndex ? ' is-active' : ''}`}
                // The button keeps focus, so the pointer must not steal it out from under the listbox.
                onMouseDown={(ev) => ev.preventDefault()}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => commit(index)}
              >
                <span className="hr-cselect-opt-label">{option.label}</span>
                {isSelected ? <Check size={13} aria-hidden="true" /> : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
