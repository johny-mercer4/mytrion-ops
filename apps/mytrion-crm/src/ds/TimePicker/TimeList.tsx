import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, Ref } from 'react';
import { Icon } from '../Icon/Icon';
import styles from './TimePicker.module.css';

/**
 * Class-list join. A CSS-module lookup is `string | undefined` under `noUncheckedIndexedAccess`, and
 * `Icon`'s `className` is an exact optional. Duplicated from TimePicker.tsx on purpose — a one-line
 * helper is cheaper to repeat than a third module for two files to import it from, which is the same
 * call Select/SelectPopup already made.
 */
const cx = (...parts: Array<string | false | undefined>): string => parts.filter(Boolean).join(' ');

export interface TimeIncrement {
  /** The `HH:mm` / `HH:mm:ss` value this row commits. */
  value: string;
  /** The same instant rendered in the field's own locale and hour cycle. */
  label: string;
}

export interface TimeListProps {
  listId: string;
  /** The field's label element, reused as the listbox's accessible name. */
  labelId: string;
  /** Prefix for row ids, so `aria-activedescendant` can name one. */
  baseId: string;
  rows: readonly TimeIncrement[];
  /** Index of the row the keyboard is on. -1 while nothing is highlighted. */
  activeIndex: number;
  /** The field's current value, or null. Drives `aria-selected`. */
  selected: string | null;
  placement: 'bottom' | 'top';
  /** Measured available space, in px. See the placement effect in TimePicker.tsx. */
  height: number;
  listRef: Ref<HTMLDivElement>;
  onChoose: (value: string) => void;
  /** Pointer hover moves the SAME highlight the keyboard drives — never a second one. */
  onHover: (index: number) => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
}

/**
 * The increment listbox — the SECONDARY affordance of TimePicker, and internal to it.
 *
 * It is a real listbox: `role="listbox"` over `role="option"` rows, one selected value, the
 * highlight published through `aria-activedescendant`. Not a styled `<select>` (whose popup is OS
 * chrome no stylesheet can reach into) and not a menu (a menu holds ACTIONS; this holds a VALUE, and
 * assistive tech announces the two differently).
 *
 * FOCUS moves into the list itself rather than staying on the trigger. There is no text input here
 * to park a caret in — the field's own segments are the typing surface — so the list is the thing
 * the arrow keys are driving and it should be the thing that has focus. The container is the focus
 * target (`tabIndex={-1}`), never the rows: 288 tab stops is not a list.
 *
 * It has no state. Everything it shows is a rendering of the model next door, which is what makes
 * the split at this seam free.
 */
export function TimeList({
  listId,
  labelId,
  baseId,
  rows,
  activeIndex,
  selected,
  placement,
  height,
  listRef,
  onChoose,
  onHover,
  onKeyDown,
}: TimeListProps) {
  return (
    <div
      className={cx(styles.popup)}
      data-placement={placement}
      style={{ '--tp-popup-h': `${height}px` } as CSSProperties}
    >
      <div
        ref={listRef}
        id={listId}
        role="listbox"
        tabIndex={-1}
        className={cx(styles.list)}
        aria-labelledby={labelId}
        aria-activedescendant={activeIndex >= 0 ? `${baseId}-inc-${activeIndex}` : undefined}
        onKeyDown={onKeyDown}
      >
        {rows.map((row, index) => {
          const isSelected = row.value === selected;
          return (
            <div
              key={row.value}
              id={`${baseId}-inc-${index}`}
              role="option"
              className={cx(styles.option)}
              aria-selected={isSelected}
              data-active={index === activeIndex || undefined}
              data-selected={isSelected || undefined}
              onPointerEnter={() => onHover(index)}
              // `onClick`, not `onPointerDown`: a pointer-down commit fires while the user is still
              // deciding, and a drag that started on a row and ended off it would have already
              // changed the value.
              onClick={() => onChoose(row.value)}
            >
              <span className={cx(styles.optionLabel)}>{row.label}</span>
              {/* A glyph, not only the wash behind the row — the selected row must be identifiable
                  without perceiving its background colour. */}
              {isSelected ? <Icon name="check" size="sm" className={cx(styles.optionTick)} /> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
