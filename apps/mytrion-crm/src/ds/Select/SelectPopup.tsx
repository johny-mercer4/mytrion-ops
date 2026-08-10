import type { CSSProperties, Ref } from 'react';
import { Icon } from '../Icon/Icon';
import type { SelectOption, VisibleGroup } from './selectModel';
import styles from './Select.module.css';

/**
 * Class-list join. A CSS-module lookup is `string | undefined` under `noUncheckedIndexedAccess`, and
 * `Icon`'s `className` is an exact optional, so module classes go through here rather than through a
 * cast at every call site. Duplicated from Select.tsx on purpose — a two-line helper is cheaper to
 * repeat than a third module for the two files to import it from.
 */
const cx = (...parts: Array<string | false | undefined>): string => parts.filter(Boolean).join(' ');

export interface SelectPopupProps {
  /** The owning Select's `useId`, so option ids match the `aria-activedescendant` it publishes. */
  baseId: string;
  listId: string;
  /** The control's label, reused as the listbox's accessible name. */
  labelId: string;
  groups: readonly VisibleGroup[];
  /** Index into the FLAT list — the same index space the rows carry. */
  activeIndex: number;
  selected: readonly string[];
  multiple: boolean;
  loading: boolean;
  /** The live filter text, verbatim, so the empty state can quote what was actually searched. */
  query: string;
  emptyLabel: string;
  placement: 'bottom' | 'top';
  /** Measured available space, in px. See the placement effect in Select.tsx. */
  height: number;
  listRef: Ref<HTMLDivElement>;
  onChoose: (option: SelectOption) => void;
  /** Pointer hover moves the SAME highlight the keyboard drives — never a second one. */
  onHover: (index: number) => void;
}

/**
 * The Select listbox. Internal — not exported from `src/ds`, and it has no state of its own.
 *
 * It exists as its own file because Select.tsx was over this repo's 600-line cap with the list
 * inlined, and because the split falls on a real seam: everything here is a pure rendering of the
 * model, while the control that owns focus, the value and the keyboard stays next door.
 *
 * TWO INDEPENDENT SIGNALS per row, because both can be true at once — `data-selected` (a wash plus a
 * check glyph, never colour alone) and `data-active` (an inset marker, a different channel entirely,
 * so a highlighted row that is also selected still reads as both).
 */
export function SelectPopup({
  baseId,
  listId,
  labelId,
  groups,
  activeIndex,
  selected,
  multiple,
  loading,
  query,
  emptyLabel,
  placement,
  height,
  listRef,
  onChoose,
  onHover,
}: SelectPopupProps) {
  const empty = groups.length === 0;

  return (
    <div
      className={cx(styles.popup)}
      data-placement={placement}
      style={{ '--select-popup-h': `${height}px` } as CSSProperties}
      // Keeps focus in the input while the user drags the scrollbar or presses a row.
      onPointerDown={(e) => e.preventDefault()}
    >
      {/* Roles on divs, not <ul>/<li>. A listbox that owns groups needs listbox > group > option with
          nothing between them; nesting a second <ul> inside an <li> inserts a `list` role into that
          chain and breaks the ownership the group depends on. Divs state the intended tree once. */}
      <div
        ref={listRef}
        id={listId}
        role="listbox"
        className={cx(styles.list)}
        aria-labelledby={labelId}
        aria-multiselectable={multiple || undefined}
      >
        {groups.map((group) => {
          const headingId = `${baseId}-grp-${group.key}`;
          const rows = group.rows.map(({ option, index }) => {
            const isSelected = selected.includes(option.value);
            return (
              <div
                key={option.value}
                id={`${baseId}-opt-${index}`}
                role="option"
                className={cx(styles.option)}
                aria-selected={isSelected}
                aria-disabled={option.disabled || undefined}
                data-active={index === activeIndex || undefined}
                data-selected={isSelected || undefined}
                data-disabled={option.disabled || undefined}
                onPointerEnter={() => {
                  if (!option.disabled) onHover(index);
                }}
                onClick={() => onChoose(option)}
              >
                {multiple ? (
                  <span className={cx(styles.check)} aria-hidden="true">
                    {isSelected ? <Icon name="check" size="sm" /> : null}
                  </span>
                ) : null}
                {option.icon ? <Icon name={option.icon} size="sm" className={cx(styles.optionIcon)} /> : null}
                <span className={cx(styles.optionLabel)}>{option.label}</span>
                {option.hint ? <span className={cx(styles.optionHint)}>{option.hint}</span> : null}
                {!multiple && isSelected ? <Icon name="check" size="sm" className={cx(styles.optionTick)} /> : null}
              </div>
            );
          });

          return group.label === null ? (
            // role="presentation" so this wrapper leaves the tree and the listbox owns the options
            // directly — an ungrouped run is a rendering detail, not a structure users should hear.
            <div key={group.key} role="presentation">
              {rows}
            </div>
          ) : (
            <div key={group.key} role="group" aria-labelledby={headingId}>
              <div id={headingId} className={cx(styles.groupLabel)} role="presentation">
                {group.label}
              </div>
              {rows}
            </div>
          );
        })}
      </div>

      {loading || empty ? (
        // Outside the listbox: this is prose ABOUT the list, not a row in it. Inside, a screen
        // reader would offer "Nothing matches …" as something you can choose.
        // Polite, because a count changing under a typing user is information, not an alarm.
        <p className={cx(styles.empty)} aria-live="polite">
          {loading
            ? 'Loading options…'
            : query.trim()
              ? // Say WHAT was searched. A bare "No results" leaves the user unsure the filter even
                // received their typing, and hides the stray character that caused it.
                `Nothing matches “${query.trim()}”`
              : emptyLabel}
        </p>
      ) : null}
    </div>
  );
}
