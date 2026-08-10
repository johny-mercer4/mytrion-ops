import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Icon } from '../Icon/Icon';
import styles from './RetryButton.module.css';

export type RetryButtonSize = 'sm' | 'md';
export type RetryButtonTone = 'error' | 'neutral';

export interface RetryButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /**
   * `error` (default) — the turn failed. Danger-tinted, to sit inside a `TurnError`.
   * `neutral` — the turn did not fail; the user stopped it, or simply wants another answer. Inside
   *   a `StoppedNote` this is the only correct tone: a red Retry next to a calm note would
   *   contradict it and re-frame a deliberate stop as a fault.
   */
  tone?: RetryButtonTone;
  /** `md` (32px) matches Button. `sm` (26px) for inline placement in a note or a dense row. */
  size?: RetryButtonSize;
  /** The retry is in flight. Keeps the control's width and blocks a second fire. */
  retrying?: boolean;
  /**
   * Which attempt this would be, 2 for the first retry. When given, it is announced as part of the
   * accessible name ("Retry, attempt 3") — three silent identical retries is the state where a user
   * most needs to know nothing is changing.
   */
  attempt?: number;
  /** Label. Default "Retry". */
  children?: ReactNode;
}

/**
 * Run the same turn again.
 *
 * It is not a Button variant because it carries its own token pair (`--retry-fg`, `--retry-bd`) and
 * a tone axis that Button has no business growing: the SAME action means different things depending
 * on whether the turn failed or the user stopped it, and only the colour distinguishes them.
 * Geometry is Button's ladder exactly, so the two line up when they share a row.
 *
 * NO SPLIT "RETRY WITH A DIFFERENT MODEL" CONTROL — deliberately not built. CONVENTIONS §7: no
 * variant without a real use site, and this codebase has none. The chat retry path takes an
 * assistant message id and nothing else (`useChat.retry(assistantId)`); there is no per-turn model
 * override in the request, no model list on the client, and no UI anywhere that picks one. A split
 * button here would be a menu whose every item does the same thing. When a model override lands in
 * the turn request, the shape to add is a `menu` slot on this component plus a divider rule in this
 * stylesheet — not a second component, and not a dropdown that only ever offers "Retry".
 *
 * KEYBOARD — native `<button>`: Tab reaches it, Enter and Space activate it. Nothing bespoke.
 *
 * RETRYING is native `disabled`, unlike StopButton's `aria-disabled`. Nothing is owed as an
 * explanation — the spinner says it — and unlike Stop, this control is not the one thing standing
 * between the user and a runaway agent, so losing focus for the duration is acceptable.
 *
 * ANNOUNCEMENT — pressing this starts a new turn, which the surface's single polite live region
 * announces ("Answering"). This button announces nothing itself.
 *
 * WHEN NOT TO USE IT
 * - A different question. Retry re-runs the SAME input; if the user edits anything, it is a new
 *   turn and belongs in the composer.
 * - A failed write, payment, or anything non-idempotent. Re-running a tool call that already had an
 *   effect is a duplicate, not a retry — that surface needs an explicit confirm.
 * - Refreshing data on a page. That is a Button with `icon="refresh"`; this one carries failure
 *   semantics it should not lend to a healthy screen.
 * - Rate-limit errors where the wait is known. Show the wait first; a Retry that is guaranteed to
 *   fail again teaches people the button is broken.
 */
export const RetryButton = forwardRef<HTMLButtonElement, RetryButtonProps>(function RetryButton(
  {
    tone = 'error',
    size = 'md',
    retrying = false,
    attempt,
    children = 'Retry',
    className,
    disabled,
    type = 'button',
    'aria-label': ariaLabel,
    ...rest
  },
  ref,
) {
  const iconSize = size === 'sm' ? 'sm' : 'md';
  const attemptLabel =
    attempt != null && typeof children === 'string' ? `${children}, attempt ${attempt}` : undefined;

  return (
    <button
      ref={ref}
      type={type}
      className={[styles.root, className].filter(Boolean).join(' ')}
      data-tone={tone}
      data-size={size}
      data-retrying={retrying || undefined}
      // Nothing to explain beyond the spinner, so native `disabled` — see the docblock.
      disabled={disabled ?? (retrying || undefined)}
      aria-busy={retrying || undefined}
      aria-label={ariaLabel ?? attemptLabel}
      {...rest}
    >
      {/* Content stays in the DOM and keeps its box while the spinner is overlaid, so the control
          does not shrink under the cursor the moment it starts working. */}
      <span className={styles.content}>
        <Icon name="refresh" size={iconSize} />
        {children}
        {attempt != null ? (
          <span className={styles.attempt} aria-hidden="true">
            {attempt}
          </span>
        ) : null}
      </span>
      {retrying ? (
        <span className={styles.spinner} aria-hidden="true">
          <span className={styles.spinnerGlyph} />
        </span>
      ) : null}
    </button>
  );
});
