/**
 * Keyboard behaviour for a `role="radiogroup"` built out of buttons.
 *
 * Declaring `role="radio"` promises a radio group, and a screen-reader user is then told to use the
 * arrow keys — but buttons do not do that on their own, so the promise is broken and every option
 * also lands in the tab order individually. That is worse than plain buttons would have been,
 * because the announced affordance does not exist.
 *
 * This restores the two halves the role implies (WAI-ARIA APG, radio group):
 *   - ROVING TABINDEX: only the checked option is tabbable, so the group is one tab stop.
 *   - ARROW / HOME / END: move between options and select as you go.
 *
 * Space and Enter still work because the elements are real buttons.
 */
import { useCallback, useRef, type KeyboardEvent } from 'react';

export interface RovingRadioProps {
  tabIndex: number;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  ref: (node: HTMLButtonElement | null) => void;
}

/**
 * @param values every option value, in the order they render
 * @param current the selected value
 * @param onSelect called with the value the keyboard moved to
 */
export function useRovingRadio<T extends string>(
  values: readonly T[],
  current: T | '',
  onSelect: (value: T) => void,
): (value: T) => RovingRadioProps {
  const nodes = useRef(new Map<T, HTMLButtonElement>());

  const move = useCallback(
    (from: number, delta: number) => {
      if (values.length === 0) return;
      // Wraps, per the APG: past the end returns to the start.
      const next = values[(from + delta + values.length) % values.length];
      if (next === undefined) return;
      onSelect(next);
      nodes.current.get(next)?.focus();
    },
    [values, onSelect],
  );

  return useCallback(
    (value: T): RovingRadioProps => {
      const index = values.indexOf(value);
      const checked = current === value;
      // Nothing selected yet: the first option carries the tab stop so the group is reachable.
      const isTabStop = checked || (current === '' && index === 0);
      return {
        tabIndex: isTabStop ? 0 : -1,
        ref: (node) => {
          if (node) nodes.current.set(value, node);
          else nodes.current.delete(value);
        },
        onKeyDown: (event) => {
          switch (event.key) {
            case 'ArrowRight':
            case 'ArrowDown':
              event.preventDefault();
              move(index, 1);
              break;
            case 'ArrowLeft':
            case 'ArrowUp':
              event.preventDefault();
              move(index, -1);
              break;
            case 'Home':
              event.preventDefault();
              move(-1, 1);
              break;
            case 'End':
              event.preventDefault();
              move(0, -1);
              break;
            default:
              break;
          }
        },
      };
    },
    [values, current, move],
  );
}
