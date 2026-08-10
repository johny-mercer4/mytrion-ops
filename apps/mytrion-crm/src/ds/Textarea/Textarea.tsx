import {
  forwardRef,
  useCallback,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type ChangeEvent,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';
import { FieldMessage, cx, describedBy, useFieldIds, type FieldSize } from '../_field/fieldParts';
import styles from './Textarea.module.css';

export type TextareaSize = FieldSize;

/** `vertical` only. Horizontal resize breaks the column a form was laid out in. */
export type TextareaResize = 'none' | 'vertical';

export interface TextareaProps
  extends Omit<
    TextareaHTMLAttributes<HTMLTextAreaElement>,
    'children' | 'className' | 'style' | 'cols'
  > {
  /** `md` (13px) is the default. `sm` (12px) matches a dense table row — same ladder as Input. */
  size?: TextareaSize;
  /**
   * Fails validation. Paints the danger border AND sets `aria-invalid`. Pair it with `message`:
   * a red border alone tells a colour-blind user nothing and a screen-reader user nothing at all.
   */
  invalid?: boolean;
  /** The message slot under the field — hint when valid, error when `invalid`. Wired into `aria-describedby`. */
  message?: ReactNode;
  /** Resting height in lines. Default 3. With `autoGrow` this is the FLOOR, not the height. */
  rows?: number;
  /**
   * Grow with the content up to `maxRows`, then scroll. Off by default: a box that changes height
   * while you type reflows everything under it, which is only worth it where the input length is
   * genuinely unpredictable (a note, a reply) rather than merely multi-line.
   */
  autoGrow?: boolean;
  /** The ceiling for `autoGrow`, in lines. Default 8. Ignored when `autoGrow` is off. */
  maxRows?: number;
  /** Default `vertical`. Forced to `none` under `autoGrow` — see the docblock. */
  resize?: TextareaResize;
  /** Spans its container. ON by default: a textarea is a block control and almost always fills its column. */
  fullWidth?: boolean;
  /** Positioning class — lands on the ROOT (shell + message), which is the box a caller lays out. */
  className?: string;
  /** Positioning style — lands on the ROOT, same reason. */
  style?: CSSProperties;
  /** Rare escape hatch for the `<textarea>` itself (a monospace note field, say). Not for layout. */
  textareaClassName?: string;
}

/**
 * The one multi-line field.
 *
 * FOCUS — identical contract to Input, and for the same documented defect: the bare `<textarea>`
 * never takes the hard `:focus-visible` outline (global.css clears it), the SHELL carries
 * `data-focus-shell`, and `[data-focus-shell]:focus-within` in global.css paints the border and
 * halo. There is no rest-state focus rule in Textarea.module.css.
 *
 * AUTOGROW — measured, not guessed. `scrollHeight` reports the content height *or* the current box
 * height, whichever is larger, so a naive implementation that never collapses the box first turns
 * the field into a one-way ratchet: it grows as you type and never comes back when you delete. The
 * effect below sets `height: auto` first, reads the content once, then clamps.
 *
 * KEYBOARD
 *   Tab / Shift+Tab   moves focus OUT. A textarea never inserts a tab character, which is native
 *                     behaviour and correct — trapping Tab inside a form field strands the user.
 *   Enter             newline. If a surface wants Enter-to-submit with Shift+Enter for a newline,
 *                     that is the surface's `onKeyDown`, not this component's: only the surface
 *                     knows whether there is anything to submit.
 *   Arrows / Home / End / Ctrl+A   native caret movement and selection.
 *
 * DISABLED vs READONLY — `disabled` means "not yours to edit". `readOnly` means "yours to read,
 * select and copy": it stays focusable and scrollable, which is the point.
 *
 * WHEN NOT TO USE IT
 * - A single line. Use Input — a textarea for a name gives the user a scrollbar and a resize grip
 *   for a field that can never need either.
 * - Rich text. This is a plain `<textarea>`; it has no marks, no links, no paste sanitisation.
 * - Code. A code field wants a monospace face, tab handling and no spellcheck — that is an editor.
 * - A chat composer. Those need send-key handling, attachment slots and a submit affordance inside
 *   the box; compose that above this rather than growing props onto it.
 */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  {
    size = 'md',
    invalid = false,
    message,
    rows = 3,
    autoGrow = false,
    maxRows = 8,
    resize = 'vertical',
    fullWidth = true,
    className,
    style,
    textareaClassName,
    id,
    value,
    onChange,
    disabled = false,
    readOnly = false,
    'aria-describedby': ariaDescribedBy,
    ...rest
  },
  ref,
) {
  const innerRef = useRef<HTMLTextAreaElement | null>(null);
  const { fieldId, messageId } = useFieldIds(id);

  // Callback ref rather than useImperativeHandle: this component needs the node to measure it AND
  // the caller needs it, and merging here avoids casting a possibly-null ref.
  const setRefs = useCallback(
    (node: HTMLTextAreaElement | null) => {
      innerRef.current = node;
      if (typeof ref === 'function') ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );

  // A script-driven height and a user-dragged one are two owners of the same property, and the drag
  // loses on the very next keystroke. So autoGrow removes the grip rather than fighting it.
  const resolvedResize: TextareaResize = autoGrow ? 'none' : resize;

  const measure = useCallback(() => {
    const el = innerRef.current;
    if (!el) return;

    if (!autoGrow) {
      // Hand the box back to CSS. Without this, turning autoGrow off leaves the last measured
      // height pinned as an inline style that no stylesheet can outrank.
      el.style.height = '';
      el.style.overflowY = '';
      return;
    }

    // Collapse first — see the AUTOGROW note in the docblock. `scrollHeight` never reports less than
    // the current box, so measuring an already-grown box only ever measures the box.
    el.style.height = 'auto';
    const content = el.scrollHeight;

    const cs = getComputedStyle(el);
    const line = Number.parseFloat(cs.lineHeight);
    // `scrollHeight` includes padding but not borders, and box-sizing is border-box app-wide
    // (global.css), so the ceiling has to carry both to describe the same box `height` will set.
    const chrome =
      Number.parseFloat(cs.paddingTop) +
      Number.parseFloat(cs.paddingBottom) +
      Number.parseFloat(cs.borderTopWidth) +
      Number.parseFloat(cs.borderBottomWidth);

    // `line-height: normal` computes to the string "normal", which parses to NaN. Falling back to
    // "no ceiling" is the safe direction: an unbounded box is ugly, a zero-height one is unusable.
    const cap =
      Number.isFinite(line) && Number.isFinite(chrome)
        ? line * Math.max(1, maxRows) + chrome
        : Number.POSITIVE_INFINITY;

    el.style.height = `${Math.min(content, cap)}px`;
    // Only once the ceiling is actually reached. A permanently `overflow-y: scroll` box reserves a
    // gutter over the last line of text on every platform with classic scrollbars.
    el.style.overflowY = content > cap ? 'auto' : 'hidden';
  }, [autoGrow, maxRows]);

  // useLayoutEffect, not useEffect: the height is applied in the same frame as the value that caused
  // it, so a controlled field never paints one frame at the wrong size and jitters.
  // `value` is a dependency so controlled resets (a form clearing itself) re-measure too.
  useLayoutEffect(() => {
    measure();
  }, [measure, value, rows, size]);

  const handleChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      onChange?.(event);
      // Uncontrolled typing changes no prop, so the effect above never re-runs. Measuring here is
      // what makes autoGrow work without forcing the caller into a controlled value.
      measure();
    },
    [measure, onChange],
  );

  return (
    <div
      className={cx(styles.root, className)}
      style={style}
      data-size={size}
      data-full={fullWidth || undefined}
    >
      {/*
        data-focus-shell is the contract, not a hint: global.css owns `:focus-within` on this
        element and clears the outline on the bare field inside it.
      */}
      <div
        className={cx(styles.shell)}
        data-focus-shell
        data-invalid={invalid || undefined}
        data-disabled={disabled || undefined}
        data-readonly={readOnly || undefined}
        data-grow={autoGrow || undefined}
      >
        <textarea
          {...rest}
          ref={setRefs}
          id={fieldId}
          className={cx(styles.field, textareaClassName)}
          rows={rows}
          value={value}
          onChange={handleChange}
          disabled={disabled}
          readOnly={readOnly}
          data-resize={resolvedResize}
          // aria-invalid, not just a red border: the border is the sighted half of the same fact.
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy(ariaDescribedBy, message ? messageId : undefined)}
        />
      </div>

      {message ? (
        <FieldMessage id={messageId} invalid={invalid}>
          {message}
        </FieldMessage>
      ) : null}
    </div>
  );
});
