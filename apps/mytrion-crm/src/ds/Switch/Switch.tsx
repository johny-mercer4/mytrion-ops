import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type MouseEvent,
  type ReactNode,
} from 'react';
import styles from './Switch.module.css';

export type SwitchSize = 'sm' | 'md';
export type SwitchLabelPlacement = 'start' | 'end';

export interface SwitchProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size' | 'children'> {
  /** The visible label, rendered inside the `<label>` so the text is part of the hit target. */
  label?: ReactNode;
  /** Secondary line — what turning it on does RIGHT NOW. Wired as `aria-describedby`. */
  description?: ReactNode;
  /** `md` (32px row) is the default. `sm` (26px row) matches Button `sm` for dense toolbars. */
  size?: SwitchSize;
  /**
   * `end` (default) puts the switch first and the label after, matching Checkbox and Radio.
   * `start` puts the label first and the switch after — the settings-row reading, where the
   * question is the sentence and the control is the answer at the end of it. Pair it with
   * `fullWidth` to push the switch to the right edge of the row.
   */
  labelPlacement?: SwitchLabelPlacement;
  /** Spans its container, so a column of settings rows aligns its switches on one edge. */
  fullWidth?: boolean;
}

/**
 * A switch: a setting that takes effect the INSTANT it is flipped.
 *
 * ANATOMY — a real `<input type="checkbox" role="switch">`. The role is the whole reason it is not
 * just a checkbox with a different skin: it makes assistive tech say "on/off" instead of
 * "checked/unchecked", which is the difference between "this is now true" and "this will be true
 * when you save". `aria-checked` is NOT set here — the native `checked` state already maps to it,
 * and hand-setting the ARIA attribute on top is how the two drift apart.
 *
 * The input is stretched over the track at `opacity: 0`. Visually hidden but NOT `display: none`
 * and NOT `visibility: hidden`: both remove the control from the accessibility tree and from the
 * tab order.
 *
 * MOTION — the KNOB translates and the TRACK recolours, so a reduced-motion user (where the
 * duration tokens are zeroed globally) still gets both signals instantly; nothing here is legible
 * only while it moves. The knob uses `translate:`, never `transform:` — a `transform` promotes the
 * element to its own composited layer and makes it a containing block for its children, which
 * stacked on `backdrop-filter` is the un-repainted-panel defect this app has already shipped. At
 * rest the property is `none`, so an unchecked switch holds no offset at all.
 *
 * STATE IS A POSITION, NOT A COLOUR — the knob is at one end or the other, and that reading
 * survives greyscale. The recolour is reinforcement.
 *
 * KEYBOARD
 *   Tab / Shift+Tab   move focus to and from the control
 *   Space             flip it
 * The native map, unmodified.
 *
 * DISABLED — `disabled` when no explanation is owed; `aria-disabled` when the UI explains why (it
 * stays focusable so a keyboard user can reach the explanation, and the click handler cancels the
 * flip). Never `pointer-events: none`.
 *
 * WHEN NOT TO USE IT
 * - Anything that needs a Save, an Apply or a confirm step. A switch PROMISES an immediate effect;
 *   if the change is pending until a footer button, it is a `Checkbox` and pretending otherwise is
 *   a lie about what just happened.
 * - A destructive or irreversible action. A switch has no confirmation step by construction — use
 *   a `Button` with `variant="danger"`.
 * - Selecting between two named things (Monthly / Yearly, Grid / List). A switch has one label and
 *   an implied "off"; two named options are a segmented control.
 * - A list of many options. A column of switches is a column of live mutations; if they are
 *   really one multi-select, use `Checkbox` rows and one Save.
 */
export const Switch = forwardRef<HTMLInputElement, SwitchProps>(function Switch(
  {
    label,
    description,
    size = 'md',
    labelPlacement = 'end',
    fullWidth = false,
    className,
    style,
    disabled,
    onClick,
    id,
    'aria-describedby': describedBy,
    'aria-disabled': ariaDisabled,
    ...rest
  },
  ref,
) {
  const reactId = useId();
  const inputId = id ?? `${reactId}-input`;
  const descriptionId = `${reactId}-desc`;

  const explained = ariaDisabled === true || ariaDisabled === 'true';

  const handleClick = (event: MouseEvent<HTMLInputElement>): void => {
    // aria-disabled announces "unavailable", so it must not flip. Preventing the default on `click`
    // cancels the checkbox activation behaviour; Space dispatches a click, so pointer and keyboard
    // are both covered by this one handler. `readOnly` would not work — it is inert on checkboxes.
    if (explained) event.preventDefault();
    onClick?.(event);
  };

  return (
    <label
      className={[styles.root, className].filter(Boolean).join(' ')}
      style={style}
      htmlFor={inputId}
      data-size={size}
      data-placement={labelPlacement}
      data-full={fullWidth || undefined}
      data-disabled={disabled || explained || undefined}
    >
      <span className={styles.control}>
        <input
          ref={ref}
          id={inputId}
          type="checkbox"
          // The one attribute that makes this a switch rather than a checkbox with rounded corners.
          role="switch"
          className={styles.input}
          disabled={disabled}
          aria-disabled={ariaDisabled}
          aria-describedby={
            [describedBy, description ? descriptionId : null].filter(Boolean).join(' ') || undefined
          }
          onClick={handleClick}
          {...rest}
        />
        {/* Inert paint. aria-hidden because the input beside it already carries the semantic. */}
        <span className={styles.track} aria-hidden="true">
          <span className={styles.knob} />
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
