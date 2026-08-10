import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useRef,
  type InputHTMLAttributes,
  type MouseEvent,
  type MutableRefObject,
  type ReactNode,
} from 'react';
import { Icon } from '../Icon/Icon';
import styles from './Checkbox.module.css';

export type CheckboxSize = 'sm' | 'md';

export interface CheckboxProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size' | 'children'> {
  /**
   * The visible label. It is rendered INSIDE the `<label>` element that wraps the input, so the
   * text is part of the hit target rather than a caption sitting next to one.
   */
  label?: ReactNode;
  /** Secondary line under the label — the consequence of ticking it. Wired as `aria-describedby`. */
  description?: ReactNode;
  /**
   * Neither checked nor unchecked: the "some of these rows are selected" header box.
   * Applied to the DOM node through a ref, because `indeterminate` is a PROPERTY of
   * HTMLInputElement and has no HTML attribute at all — there is literally no markup that expresses
   * it, which is why this prop cannot simply be spread onto the input.
   */
  indeterminate?: boolean;
  /**
   * Marks the control as failing validation. Sets `aria-invalid`, so the state is ANNOUNCED and not
   * merely tinted. Always pair it with a `description` saying what is wrong — the red edge is a
   * reinforcement, never the message.
   */
  invalid?: boolean;
  /** `md` (32px row) is the default. `sm` (26px row) matches Button `sm` for dense table rows. */
  size?: CheckboxSize;
}

/**
 * A checkbox: an independent on/off choice that is COMMITTED LATER, by a Save or an Apply.
 *
 * ANATOMY — a real `<input type="checkbox">` sits inside the `<label>`, stretched over the hit
 * square at `opacity: 0`. It is visually hidden but NOT `display: none` and NOT
 * `visibility: hidden`: both of those remove the control from the accessibility tree and from the
 * tab order, which is how "custom checkbox" implementations become keyboard-dead. The box you see
 * is an inert sibling `<span>` driven entirely by `:checked` / `:indeterminate` / `:focus-visible`
 * on that input — so the visual is correct even when the checkbox is uncontrolled and React never
 * learns its value.
 *
 * STATE IS A SHAPE, NOT A COLOUR — empty box, tick, dash. Three distinguishable glyphs, so the
 * state survives greyscale, low vision and a colour-blind reader.
 *
 * INDETERMINATE BEATS CHECKED, per HTML: an input may carry both, and the browser paints mixed.
 * The CSS follows that precedence deliberately, so a select-all header that is both `checked` and
 * `indeterminate` shows the dash rather than a tick.
 *
 * KEYBOARD
 *   Tab / Shift+Tab   move focus to and from the control
 *   Space             toggle
 * That is the native map, unmodified. Nothing here intercepts a key, which is the point of wrapping
 * a real input instead of painting a `<div role="checkbox">`.
 *
 * DISABLED — pass `disabled` when no explanation is owed. Pass `aria-disabled` when the UI explains
 * WHY (a tooltip, an inline hint): it keeps the control focusable so a keyboard user can reach the
 * explanation, and the click handler below cancels the toggle. Cancelling on `click` is enough for
 * Space too, because Space on a checkbox dispatches a synthetic click. Never `pointer-events: none`.
 *
 * WHEN NOT TO USE IT
 * - An immediate effect — flipping a live setting, muting a channel. That is a `Switch`. A checkbox
 *   promises a pending change; if there is no Save button the promise is a lie.
 * - One choice out of several mutually exclusive ones. That is `RadioGroup`.
 * - A filter chip or a multi-select of many options in a small space — that is a chip row or a
 *   select, not twenty checkboxes.
 * - As a read-only status glyph in a table cell. A control the user cannot operate should not look
 *   operable; render an `Icon`.
 */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  {
    label,
    description,
    indeterminate = false,
    invalid = false,
    size = 'md',
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

  const innerRef = useRef<HTMLInputElement | null>(null);
  // One callback ref feeding both the local ref (for the indeterminate property) and whatever the
  // caller passed. Assigning `ref.current` directly is the documented way to forward an object ref
  // from a callback ref; there is no ergonomic alternative that also lets this component read the
  // node.
  const setRefs = useCallback(
    (node: HTMLInputElement | null) => {
      innerRef.current = node;
      if (typeof ref === 'function') ref(node);
      else if (ref) (ref as MutableRefObject<HTMLInputElement | null>).current = node;
    },
    [ref],
  );

  // React does not manage `indeterminate` — it is not in its attribute table — so nothing resets it
  // on re-render and this effect is the only writer.
  useEffect(() => {
    if (innerRef.current) innerRef.current.indeterminate = indeterminate;
  }, [indeterminate]);

  const explained = ariaDisabled === true || ariaDisabled === 'true';

  const handleClick = (event: MouseEvent<HTMLInputElement>): void => {
    // An `aria-disabled` control announces itself as unavailable, so it must not toggle. Preventing
    // the default on `click` cancels the checkbox's activation behaviour outright — a readOnly
    // attribute would NOT (it is inert on checkboxes) and is the usual bug here.
    if (explained) event.preventDefault();
    onClick?.(event);
  };

  return (
    <label
      className={[styles.root, className].filter(Boolean).join(' ')}
      style={style}
      htmlFor={inputId}
      data-size={size}
      data-invalid={invalid || undefined}
      data-disabled={disabled || explained || undefined}
      data-indeterminate={indeterminate || undefined}
    >
      <span className={styles.control}>
        <input
          ref={setRefs}
          id={inputId}
          type="checkbox"
          className={styles.input}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          aria-disabled={ariaDisabled}
          aria-describedby={
            [describedBy, description ? descriptionId : null].filter(Boolean).join(' ') || undefined
          }
          onClick={handleClick}
          {...rest}
        />
        {/* Inert paint. `aria-hidden` because the input beside it already carries the whole
            semantic — announcing the glyph too would say "checkbox, checked, checked". */}
        <span className={styles.box} aria-hidden="true">
          {/* `?? ''` and not a bare `styles.tick`: CSS-module keys type as `string | undefined`, and
              under exactOptionalPropertyTypes that is not assignable to Icon's `className?: string`. */}
          <Icon name="check" size="sm" className={styles.tick ?? ''} />
          <span className={styles.dash} />
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
