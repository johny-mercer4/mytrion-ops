import {
  useId,
  useMemo,
  type ChangeEvent,
  type FieldsetHTMLAttributes,
  type ReactNode,
} from 'react';
import { Icon } from '../Icon/Icon';
import { RadioGroupContext, type RadioGroupContextValue } from './radioContext';
import type { RadioSize } from './Radio';
import styles from './RadioGroup.module.css';

export type RadioGroupOrientation = 'vertical' | 'horizontal';

export interface RadioGroupProps
  extends Omit<FieldsetHTMLAttributes<HTMLFieldSetElement>, 'onChange' | 'defaultValue'> {
  /**
   * The shared `name` for every option. Generated if omitted — and generating it is the SAFE
   * default, see the docblock: two groups that share a name are one group as far as the browser is
   * concerned.
   */
  name?: string;
  /** Controlled selection. Pass it together with `onChange`. Omit for an uncontrolled group. */
  value?: string;
  /** Uncontrolled initial selection. Ignored when `value` is supplied. */
  defaultValue?: string;
  /** Fires with the selected VALUE first, because that is what a caller almost always wants. */
  onChange?: (value: string, event: ChangeEvent<HTMLInputElement>) => void;
  /** The group's question, rendered as a `<legend>` — the accessible name of the whole group. */
  label?: ReactNode;
  /** Guidance under the legend, above the options. Wired as `aria-describedby` on every option. */
  description?: ReactNode;
  /**
   * The validation failure. Rendering it sets `aria-invalid` on every option and adds the message
   * to their `aria-describedby`, so the failure is spoken, not merely tinted red.
   */
  error?: ReactNode;
  /** `vertical` (default) stacks. `horizontal` wraps a short set of two or three onto one line. */
  orientation?: RadioGroupOrientation;
  /** Applied to every option. An option may still disable itself individually. */
  disabled?: boolean;
  /** Applied to every option, which is how a native radio group expresses "you must pick one". */
  required?: boolean;
  /** Passed down so a whole group goes dense at once. */
  size?: RadioSize;
  /** `Radio` elements. Dividers, headings and non-radio content between them are fine. */
  children: ReactNode;
}

/**
 * The group wrapper for `Radio`. It owns the four things that belong to the SET rather than to any
 * one option: the shared `name`, the selected value, the change handler, and the group-wide
 * disabled / size / validity.
 *
 * WHAT IT DELIBERATELY DOES NOT DO — roving focus. Browsers already implement arrow-key roving for
 * radios that share a `name`: Tab enters the group at the checked option (or the first, when none
 * is checked) and moves OUT of it, arrows move within and select as they go. Re-implementing that
 * with a keydown handler and `tabIndex={-1}` is the classic way to end up selecting twice per key
 * press, breaking Home/End, or mishandling a disabled member. There is no key handler in this file
 * and that is the feature.
 *
 * WHY IT GENERATES A NAME — roving binds radios by `name` across the whole document, not by DOM
 * ancestry. Two groups that happen to share "status" become one group: arrowing through the first
 * silently clears the second, and only one of the two can ever be selected. A `useId`-derived name
 * makes that collision unspellable. Pass `name` explicitly only when a real form POST needs a
 * specific key.
 *
 * KEYBOARD
 *   Tab / Shift+Tab   enter and leave the group (one stop, not one per option)
 *   Arrow keys        move within the group and select as they move
 *   Space             select the focused option, when the group was entered with none selected
 *
 * ELEMENT — a `<fieldset>` with a `<legend>`, because that pairing is what makes a screen reader
 * announce "Status, radio group, 2 of 4" instead of reading four orphan radios. `role="radiogroup"`
 * is set explicitly for the case where a caller styles the fieldset away.
 *
 * WHEN NOT TO USE IT
 * - Two mutually exclusive options where one is plainly the default (on/off, yes/no). That is a
 *   `Switch` or a `Checkbox`.
 * - More than about seven options, or ones the user would want to search or type. That is a
 *   `Select`; a radio group's whole value is that every option is visible at once.
 * - A view/mode toggle applied immediately (list vs board, day vs week). That is a segmented
 *   control — radios promise a pending form value.
 * - Multiple selection. Any number of `Checkbox` rows, never radios.
 */
export function RadioGroup({
  name,
  value,
  defaultValue,
  onChange,
  label,
  description,
  error,
  orientation = 'vertical',
  disabled,
  required,
  size = 'md',
  children,
  className,
  style,
  'aria-describedby': describedBy,
  ...rest
}: RadioGroupProps) {
  const reactId = useId();
  const groupName = name ?? `${reactId}-radio-group`;
  const descriptionId = `${reactId}-desc`;
  const errorId = `${reactId}-error`;

  const ownDescribedBy =
    [description ? descriptionId : null, error ? errorId : null].filter(Boolean).join(' ') ||
    undefined;

  const context = useMemo<RadioGroupContextValue>(
    () => ({
      name: groupName,
      value,
      defaultValue,
      onChange,
      disabled,
      required,
      invalid: Boolean(error),
      size,
      describedBy: ownDescribedBy,
    }),
    [groupName, value, defaultValue, onChange, disabled, required, error, size, ownDescribedBy],
  );

  return (
    <fieldset
      className={[styles.root, className].filter(Boolean).join(' ')}
      style={style}
      // Redundant against a <fieldset><legend>, and kept anyway: the mapping only holds while the
      // legend is the fieldset's first child, and a caller who wraps or reorders it would otherwise
      // silently lose the grouping.
      role="radiogroup"
      data-orientation={orientation}
      data-disabled={disabled || undefined}
      data-invalid={error ? true : undefined}
      aria-describedby={[describedBy, ownDescribedBy].filter(Boolean).join(' ') || undefined}
      {...rest}
    >
      {label ? (
        <legend className={styles.legend}>
          {label}
          {required ? (
            <span className={styles.required} aria-hidden="true">
              *
            </span>
          ) : null}
        </legend>
      ) : null}
      {description ? (
        <p className={styles.description} id={descriptionId}>
          {description}
        </p>
      ) : null}
      <div className={styles.options}>
        <RadioGroupContext.Provider value={context}>{children}</RadioGroupContext.Provider>
      </div>
      {error ? (
        // The icon is what keeps the failure from being colour-only; the text is what keeps it from
        // being icon-only. `aria-live` is absent on purpose — the message is already reachable
        // through every option's aria-describedby, and announcing it twice is worse than once.
        <p className={styles.error} id={errorId}>
          <Icon name="error" size="sm" />
          <span>{error}</span>
        </p>
      ) : null}
    </fieldset>
  );
}
