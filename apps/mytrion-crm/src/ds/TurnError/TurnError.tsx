import { useId, useState, type CSSProperties, type ReactNode } from 'react';
import { Icon, type IconName } from '../Icon/Icon';
import { RetryButton } from '../RetryButton/RetryButton';
import styles from './TurnError.module.css';

/**
 * How a turn failed. Mirrors the chat runtime's own classification so a caller can pass its kind
 * straight through, plus `unknown` for the case nobody classified — which is a real case and must
 * not be silently mapped onto `server`.
 */
export type TurnErrorKind = 'rate-limit' | 'network' | 'server' | 'stream' | 'unknown';

interface KindPresentation {
  label: string;
  icon: IconName;
}

/**
 * Kind → headline. The headline is a SUMMARY; it never replaces the underlying message, which is
 * always rendered verbatim underneath it.
 */
const KIND: Record<TurnErrorKind, KindPresentation> = {
  'rate-limit': { label: 'Rate limited', icon: 'schedule' },
  network: { label: 'Connection lost', icon: 'link_off' },
  server: { label: 'Server error', icon: 'error' },
  stream: { label: 'Stream interrupted', icon: 'warning' },
  unknown: { label: 'Turn failed', icon: 'error' },
};

export interface TurnErrorProps {
  /**
   * The underlying error message, VERBATIM. Required, and never truncated or replaced by a friendly
   * paraphrase: the people reading this run the system, and the raw string is the thing they can
   * act on. If you find yourself wanting to hide it, the fix is upstream — produce a better message.
   */
  message: string;
  /** What kind of failure it was. Drives the headline and its icon. Default `unknown`. */
  kind?: TurnErrorKind;
  /** Override the headline. Use when the caller knows more than the kind does, not to soften it. */
  title?: string;
  /**
   * Diagnostics too long or too noisy for the body — a request id, a stack, a tool payload. Shown
   * in a collapsed disclosure, preformatted and selectable. Still never a substitute for `message`.
   */
  detail?: string;
  /** Label for the disclosure. Default "Details". */
  detailLabel?: string;
  /** Renders a `RetryButton`. Omit when re-running the turn is not safe or not possible. */
  onRetry?: (() => void) | undefined;
  /** The retry is in flight. */
  retrying?: boolean;
  /** Which attempt a retry would be — 2 for the first. Passed through to `RetryButton`. */
  attempt?: number;
  /** Extra caller actions beside Retry — "Open the run", "Report it". Kept to one or two. */
  actions?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

/**
 * A turn that failed.
 *
 * NEVER SWALLOWS THE ERROR. `message` is rendered as given, in selectable body-weight text, above
 * anything this component adds. The headline is a derived summary sitting beside it, not instead of
 * it, and `detail` carries the request id or stack that would otherwise be lost. This is an internal
 * ops tool: the person reading a failed agent turn is usually the person who can go fix it, and a
 * paraphrase costs them the one string that would have told them where to look.
 *
 * ROLE=ALERT — the root is an alert, so a screen reader hears the failure the moment it renders,
 * without moving focus. That has a consequence for the surface around it: the streaming panel's ONE
 * polite live region must NOT also announce the failure, or the same event is read twice, once
 * assertively and once politely. Let the live region cover the ordinary transitions ("Answering",
 * "Ran 3 tools", "Done") and let this own the failure.
 *
 * The headline is a `<p>`, not a heading. A transcript can hold dozens of turns; injecting an
 * `<h3>` per failure would build a document outline out of errors.
 *
 * KEYBOARD — the body takes no focus. Tab order inside is: Details disclosure (Enter/Space toggles,
 * `aria-expanded` + `aria-controls` on the button) → Retry → any `actions`. Nothing is trapped, and
 * nothing is reachable only by pointer.
 *
 * COLOUR IS NEVER THE SIGNAL. The icon, the headline text and the border all say "failed"; the fill
 * is the quietest of the four so the message stays readable rather than being tinted into a wash.
 *
 * WHEN NOT TO USE IT
 * - A stopped generation. That is `StoppedNote` — neutral, unannounced, not a failure.
 * - A denied tool call. RBAC refusing a tool is the system working; it belongs in the tool chip's
 *   `denied` state, and colouring it as a turn failure is the exact defect the token layer separates.
 * - A validation problem in the composer. That is a field error next to the field, not a failed turn.
 * - A page- or app-level failure. This is scoped to ONE turn inside a transcript; a whole screen
 *   failing needs a page-level empty/error state with different weight.
 * - An error the user can do nothing about AND that does not affect the answer. Do not manufacture
 *   an alert out of a warning nobody can act on.
 */
export function TurnError({
  message,
  kind = 'unknown',
  title,
  detail,
  detailLabel = 'Details',
  onRetry,
  retrying = false,
  attempt,
  actions,
  className,
  style,
}: TurnErrorProps) {
  const [open, setOpen] = useState(false);
  const detailId = useId();
  const presentation = KIND[kind];
  const hasActions = Boolean(onRetry) || Boolean(actions);

  return (
    <div
      // Assertive by definition of the role: the turn the user was waiting for is not coming.
      // Deliberately NOT focus-stealing — an alert announces without moving the caret.
      role="alert"
      className={[styles.root, className].filter(Boolean).join(' ')}
      data-kind={kind}
      style={style}
    >
      <p className={styles.head}>
        {/* Labelled, because here the icon carries meaning rather than decorating a label that
            already says the same thing — it is the non-colour signal for "this failed". */}
        <Icon name={presentation.icon} size="sm" label={presentation.label} />
        <span className={styles.kind}>{title ?? presentation.label}</span>
      </p>

      {/* The raw message. Body-weight and near-full contrast rather than danger-red: it is the part
          people read and copy, and red body text at 13px is the fastest way to make it unreadable. */}
      <p className={styles.message}>{message}</p>

      {detail ? (
        <div className={styles.detail}>
          <button
            type="button"
            className={styles.disclosure}
            aria-expanded={open}
            aria-controls={detailId}
            onClick={() => setOpen((v) => !v)}
          >
            {/* Two icon NAMES rather than one rotated icon: a permanent transform promotes the
                element to its own composited layer, which is the repaint defect this app has
                already shipped once. Swapping the glyph costs nothing and avoids it entirely. */}
            <Icon name={open ? 'expand_more' : 'chevron_right'} size="sm" />
            {detailLabel}
          </button>
          {/* Rendered only when open — a collapsed <pre> full of a stack trace is still in the
              accessibility tree and still found by browser find-in-page. */}
          {open ? (
            <pre id={detailId} className={styles.pre}>
              {detail}
            </pre>
          ) : (
            <div id={detailId} hidden />
          )}
        </div>
      ) : null}

      {hasActions ? (
        <div className={styles.actions}>
          {onRetry ? (
            <RetryButton
              tone="error"
              size="sm"
              retrying={retrying}
              {...(attempt != null ? { attempt } : {})}
              onClick={onRetry}
            />
          ) : null}
          {actions}
        </div>
      ) : null}
    </div>
  );
}
