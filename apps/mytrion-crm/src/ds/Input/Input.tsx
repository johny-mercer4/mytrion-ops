import {
  forwardRef,
  useCallback,
  useRef,
  useState,
  type CSSProperties,
  type ChangeEvent,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { Icon, type IconName } from '../Icon/Icon';
import { FieldMessage, cx, describedBy, useFieldIds, type FieldSize } from '../_field/fieldParts';
import styles from './Input.module.css';

export type InputSize = FieldSize;

/**
 * The types this app actually puts in a box. Not the full HTML list: `checkbox`, `radio`, `range`,
 * `file` and `color` are different controls wearing the same tag name, and styling them through a
 * text field's shell is how you get a checkbox with a placeholder.
 */
export type InputType = 'text' | 'email' | 'tel' | 'number' | 'search' | 'password' | 'url';

export interface InputLabels {
  /** Accessible name of the clear button. */
  clear?: string;
  /** Accessible name of the password toggle while the value is HIDDEN (pressing it reveals). */
  reveal?: string;
  /** Accessible name of the password toggle while the value is VISIBLE (pressing it hides). */
  hide?: string;
}

const DEFAULT_LABELS: Required<InputLabels> = {
  clear: 'Clear',
  reveal: 'Show password',
  hide: 'Hide password',
};

export interface InputProps
  extends Omit<
    InputHTMLAttributes<HTMLInputElement>,
    'size' | 'prefix' | 'suffix' | 'type' | 'children' | 'className' | 'style'
  > {
  /** Defaults to `text`. `search` opts into the clear affordance; `password` into the reveal toggle. */
  type?: InputType;
  /** `md` (32px) is the default. `sm` (26px) is for table rows and dense toolbars — matches Button. */
  size?: InputSize;
  /**
   * Fails validation. Paints the danger border AND sets `aria-invalid`. Pair it with `message`:
   * a red border on its own tells a colour-blind user nothing and a screen-reader user why-less.
   */
  invalid?: boolean;
  /**
   * The message slot under the field — a hint when valid, the error when `invalid`. Wired into
   * `aria-describedby` automatically, so it is announced when the field takes focus.
   */
  message?: ReactNode;
  /** Leading icon. Decoration beside a labelled field, so it is hidden from assistive tech. */
  icon?: IconName;
  /**
   * Renders a clear button while the field holds a value. Defaults to `true` for `type="search"`,
   * `false` otherwise. Works controlled and uncontrolled — see `clear()` below.
   */
  clearable?: boolean;
  /** Fired after the value has been cleared. The `onChange` for the emptying fires first. */
  onClear?: () => void;
  /** Text node before the value — a currency mark, a scheme, a unit. */
  prefix?: ReactNode;
  /** Text node after the value — a unit, a domain suffix. */
  suffix?: ReactNode;
  /** Spans its container. Off by default: most fields here sit in a toolbar at their own width. */
  fullWidth?: boolean;
  /** Accessible names for the built-in affordances. One prop, so i18n is one object, not three props. */
  labels?: InputLabels;
  /** Positioning class — lands on the ROOT (shell + message), which is the box a caller lays out. */
  className?: string;
  /** Positioning style — lands on the ROOT, same reason. */
  style?: CSSProperties;
  /** Rare escape hatch for the `<input>` itself (a monospace value column, say). Not for layout. */
  inputClassName?: string;
}

/**
 * The one text field.
 *
 * FOCUS — the field itself never takes the hard `:focus-visible` outline. `global.css` clears the
 * outline on bare `input`/`textarea`/`select` precisely because letting it land there produced the
 * "ugly internal accent ring inside every search bar" defect this app shipped. Instead the SHELL
 * carries `data-focus-shell`, and the global `[data-focus-shell]:focus-within` rule paints the
 * border and halo on the wrapper. That is why you will not find a focus rule in Input.module.css
 * for the resting case — writing one here would be a second author for the same appearance.
 *
 * KEYBOARD
 *   Tab / Shift+Tab   in and out of the field, then the clear button, then the password toggle
 *                     (DOM order). Neither affordance is removed from the tab order: an affordance
 *                     a keyboard user cannot reach is a decoration.
 *   Enter             native implicit form submission. Not intercepted.
 *   Escape            clears a non-empty `type="search"` field. Handled ONLY in that case, so an
 *                     Escape inside a dialog still closes the dialog everywhere else.
 *   Space / Enter     activate the clear and reveal buttons (they are native `<button>`s).
 *
 * DISABLED vs READONLY — `disabled` means "not yours to edit"; the affordances go with it.
 * `readOnly` means "yours to read and copy, not to change": it stays focusable and selectable, which
 * is the entire point, and the affordances are hidden because there is nothing to clear.
 *
 * WHEN NOT TO USE IT
 * - Choosing from a known set. That is a Select or a Combobox; a text field that only accepts six
 *   spellings is a quiz.
 * - Multi-line text. Use Textarea — a single-line input silently drops pasted newlines.
 * - Search that drives a results list you have to arrow into. That is a Combobox with
 *   `aria-activedescendant`; this field has no listbox relationship to expose.
 * - A number you actually want a stepper for at the ends of its range. Use a Slider or a Stepper;
 *   `type="number"` is a text field with tiny arrows.
 * - Currency or masked entry where the value and the display differ. That needs a masking layer
 *   above this, not a `prefix`.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    type = 'text',
    size = 'md',
    invalid = false,
    message,
    icon,
    clearable,
    onClear,
    prefix,
    suffix,
    fullWidth = false,
    labels,
    className,
    style,
    inputClassName,
    id,
    value,
    defaultValue,
    onChange,
    onKeyDown,
    disabled = false,
    readOnly = false,
    'aria-describedby': ariaDescribedBy,
    ...rest
  },
  ref,
) {
  const innerRef = useRef<HTMLInputElement | null>(null);
  const { fieldId, messageId, prefixId, suffixId } = useFieldIds(id);
  const text = { ...DEFAULT_LABELS, ...labels };

  // Callback ref rather than useImperativeHandle: the component needs the node (to clear it and to
  // return focus) AND the caller needs it, and merging here avoids casting a possibly-null ref.
  const setRefs = useCallback(
    (node: HTMLInputElement | null) => {
      innerRef.current = node;
      if (typeof ref === 'function') ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );

  // Emptiness drives the clear affordance, and it has to work for BOTH modes. Controlled callers
  // are the source of truth; uncontrolled ones have no prop to read, so we mirror the DOM.
  const controlled = value !== undefined;
  const [dirty, setDirty] = useState(() => String(defaultValue ?? '') !== '');
  const hasValue = controlled ? String(value ?? '') !== '' : dirty;

  const [revealed, setRevealed] = useState(false);
  const isPassword = type === 'password';
  // Swapping the `type` attribute is the only reveal that works: there is no CSS that un-dots a
  // password field, and re-rendering the value into a second element would leak it into the DOM
  // twice and break autofill.
  const renderedType = isPassword && revealed ? 'text' : type;

  const showClear = (clearable ?? type === 'search') && hasValue && !disabled && !readOnly;

  const handleChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      if (!controlled) setDirty(event.target.value !== '');
      onChange?.(event);
    },
    [controlled, onChange],
  );

  const clear = useCallback(() => {
    const el = innerRef.current;
    if (!el) return;

    // React keeps its own copy of the DOM value on the node and SKIPS onChange when the value it
    // reads back is the one it last wrote. Assigning `el.value = ''` therefore empties the box on
    // screen while React still believes the old value — the field looks cleared and a controlled
    // parent never hears about it, so the next keystroke restores the old text. Writing through the
    // prototype's setter bypasses that tracker, and the dispatched `input` event then reaches React
    // as an ordinary change. This is the only way one code path serves controlled and uncontrolled.
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    if (descriptor?.set) descriptor.set.call(el, '');
    else el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));

    // Focus goes back to the field, not to the button that vanished under the cursor. A clear
    // button that leaves focus on a removed node drops the keyboard user at the top of the page.
    el.focus();
    onClear?.();
  }, [onClear]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      onKeyDown?.(event);
      if (event.defaultPrevented) return;
      // Escape-to-clear is a search convention and ONLY a search convention. Claiming Escape on
      // every field would swallow the key that closes the dialog the field is sitting in.
      if (event.key === 'Escape' && type === 'search' && hasValue && !disabled && !readOnly) {
        event.preventDefault();
        // We handled it; the surrounding dialog must not also act on the same press.
        event.stopPropagation();
        clear();
      }
    },
    [clear, disabled, hasValue, onKeyDown, readOnly, type],
  );

  const iconSize = size === 'sm' ? 'sm' : 'md';

  return (
    <div
      className={cx(styles.root, className)}
      style={style}
      data-size={size}
      data-full={fullWidth || undefined}
    >
      {/*
        data-focus-shell is the contract, not a hint: global.css owns `:focus-within` on this
        element and clears the outline on the bare field inside it. The border and background
        declared in Input.module.css are what that global rule recolours.
      */}
      <div
        className={cx(styles.shell)}
        data-focus-shell
        data-invalid={invalid || undefined}
        data-disabled={disabled || undefined}
        data-readonly={readOnly || undefined}
        data-filled={hasValue || undefined}
      >
        {icon ? <Icon name={icon} size={iconSize} className={cx(styles.leading)} /> : null}

        {/* Affixes are described, not decorative: "$" and "gal" change what the field means, and a
            screen-reader user who only hears the label would enter the wrong unit. Pass a prefix
            ONLY when it carries meaning — if it is ornament, it does not belong in the field. */}
        {prefix ? (
          <span className={cx(styles.affix)} id={prefixId}>
            {prefix}
          </span>
        ) : null}

        <input
          {...rest}
          ref={setRefs}
          id={fieldId}
          type={renderedType}
          className={cx(styles.field, inputClassName)}
          value={value}
          defaultValue={defaultValue}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          readOnly={readOnly}
          // aria-invalid, not just a red border: the border is the sighted half of the same fact.
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy(
            ariaDescribedBy,
            prefix ? prefixId : undefined,
            suffix ? suffixId : undefined,
            message ? messageId : undefined,
          )}
        />

        {suffix ? (
          <span className={cx(styles.affix)} id={suffixId}>
            {suffix}
          </span>
        ) : null}

        {showClear ? (
          <button
            type="button"
            className={cx(styles.affordance)}
            onClick={clear}
            aria-label={text.clear}
            aria-controls={fieldId}
          >
            <Icon name="close" size="sm" />
          </button>
        ) : null}

        {isPassword ? (
          <button
            type="button"
            className={cx(styles.affordance)}
            onClick={() => setRevealed((v) => !v)}
            // BOTH signals, and they are not redundant. aria-pressed says "this is a toggle and it
            // is currently on"; the name says what pressing it will DO. A toggle whose name never
            // changes leaves a screen-reader user guessing which way it points.
            aria-pressed={revealed}
            aria-label={revealed ? text.hide : text.reveal}
            aria-controls={fieldId}
            disabled={disabled}
          >
            <Icon name={revealed ? 'visibility_off' : 'visibility'} size="sm" />
          </button>
        ) : null}
      </div>

      {message ? (
        <FieldMessage id={messageId} invalid={invalid}>
          {message}
        </FieldMessage>
      ) : null}
    </div>
  );
});
