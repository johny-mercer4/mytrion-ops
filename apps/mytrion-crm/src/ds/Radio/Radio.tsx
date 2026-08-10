import {
  forwardRef,
  useContext,
  useId,
  type ChangeEvent,
  type InputHTMLAttributes,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { RadioGroupContext } from './radioContext';
import styles from './Radio.module.css';

export type RadioSize = 'sm' | 'md';

export interface RadioProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size' | 'children' | 'value'> {
  /** The value this option contributes when selected. Required — a radio without one selects nothing. */
  value: string;
  /** The visible label, rendered inside the `<label>` so the text is part of the hit target. */
  label?: ReactNode;
  /** Secondary line under the label — what choosing this option means. Wired as `aria-describedby`. */
  description?: ReactNode;
  /** Marks the option as failing validation. Normally inherited from `RadioGroup`, not set here. */
  invalid?: boolean;
  /** `md` (32px row) is the default. `sm` (26px row) matches Button `sm` for dense forms. */
  size?: RadioSize;
}

/**
 * One option in a mutually exclusive set. Almost always a child of `RadioGroup`.
 *
 * ANATOMY — identical to `Checkbox`: a real `<input type="radio">` stretched over the hit square at
 * `opacity: 0` (visually hidden but still in the accessibility tree and the tab order), with an
 * inert sibling `<span>` painted from `:checked` / `:focus-visible`. The ring-and-dot is a SHAPE
 * difference from the checkbox's square, which is the affordance that tells a user "one of these"
 * rather than "any of these" before they read a word.
 *
 * KEYBOARD — entirely native, and that is the design:
 *   Tab              enter the group, landing on the CHECKED option (or the first, if none is)
 *   Arrow keys       move to the previous/next option in the same `name` group AND select it
 *   Shift+Tab        leave the group
 * There is no `onKeyDown` in this file. Browsers implement roving focus for same-name radios, and
 * a hand-rolled key handler on top of that is how a group ends up selecting twice per press or
 * skipping the disabled member incorrectly.
 *
 * WHY THE GROUP OWNS `name` — arrow-key roving binds radios by `name`, not by DOM ancestry. Two
 * groups on one page that happen to share a name become ONE group, and arrowing through the first
 * silently unselects the second. `RadioGroup` generates a unique name for exactly that reason.
 *
 * DISABLED — `disabled` when no explanation is owed; `aria-disabled` when the UI explains why (it
 * stays focusable, and the click handler cancels selection). Never `pointer-events: none`.
 *
 * WHEN NOT TO USE IT
 * - A single on/off choice. One radio is a broken checkbox: native radios cannot be UNSELECTED by
 *   the user, so a lone one is a trap.
 * - More than about seven options, or options the user must search. That is a `Select`.
 * - An immediate effect with no Save — that is a segmented control or a `Switch`.
 * - Outside a `RadioGroup` without passing `name` yourself. A radio with no name is not in any
 *   group, so nothing is mutually exclusive and arrow keys do nothing.
 */
export const Radio = forwardRef<HTMLInputElement, RadioProps>(function Radio(
  {
    value,
    label,
    description,
    invalid,
    size,
    className,
    style,
    disabled,
    checked,
    defaultChecked,
    name,
    onChange,
    onClick,
    id,
    'aria-describedby': describedBy,
    'aria-disabled': ariaDisabled,
    ...rest
  },
  ref,
) {
  const group = useContext(RadioGroupContext);
  const reactId = useId();
  const inputId = id ?? `${reactId}-input`;
  const descriptionId = `${reactId}-desc`;

  const resolvedName = name ?? group?.name;
  const resolvedSize = size ?? group?.size ?? 'md';
  const resolvedInvalid = invalid ?? group?.invalid ?? false;
  const resolvedDisabled = disabled ?? group?.disabled;

  // Controlled vs uncontrolled is decided ONCE, here, and the two are never both handed to the
  // input — React logs a warning and the field silently stops responding if they are. An own
  // `checked` prop wins; then the group's controlled value; then a default from either source.
  const controlled = checked ?? (group && group.value !== undefined ? group.value === value : undefined);
  const uncontrolledDefault =
    controlled !== undefined
      ? undefined
      : (defaultChecked ??
        (group && group.value === undefined && group.defaultValue !== undefined
          ? group.defaultValue === value
          : undefined));

  const explained = ariaDisabled === true || ariaDisabled === 'true';

  const handleChange = (event: ChangeEvent<HTMLInputElement>): void => {
    group?.onChange?.(value, event);
    onChange?.(event);
  };

  const handleClick = (event: MouseEvent<HTMLInputElement>): void => {
    // aria-disabled announces "unavailable", so it must not select. Preventing the default on
    // `click` cancels the radio's activation behaviour, and Space dispatches a click, so this one
    // handler covers pointer and keyboard alike.
    if (explained) event.preventDefault();
    onClick?.(event);
  };

  return (
    <label
      className={[styles.root, className].filter(Boolean).join(' ')}
      style={style}
      htmlFor={inputId}
      data-size={resolvedSize}
      data-invalid={resolvedInvalid || undefined}
      data-disabled={resolvedDisabled || explained || undefined}
    >
      <span className={styles.control}>
        <input
          ref={ref}
          id={inputId}
          type="radio"
          className={styles.input}
          value={value}
          name={resolvedName}
          disabled={resolvedDisabled}
          required={group?.required}
          aria-invalid={resolvedInvalid || undefined}
          aria-disabled={ariaDisabled}
          aria-describedby={
            [describedBy, group?.describedBy, description ? descriptionId : null]
              .filter(Boolean)
              .join(' ') || undefined
          }
          {...(controlled !== undefined ? { checked: controlled } : {})}
          {...(uncontrolledDefault !== undefined ? { defaultChecked: uncontrolledDefault } : {})}
          onChange={handleChange}
          onClick={handleClick}
          {...rest}
        />
        {/* Inert paint. aria-hidden because the input beside it already carries the semantic. */}
        <span className={styles.box} aria-hidden="true">
          <span className={styles.dot} />
        </span>
      </span>
      {label || description ? (
        <span className={styles.text}>
          {label ? <span className={styles.label}>{label}</span> : null}
          {description ? (
            <span className={styles.description} id={descriptionId}>
              {description}
            </span>
          ) : null}
        </span>
      ) : null}
    </label>
  );
});
