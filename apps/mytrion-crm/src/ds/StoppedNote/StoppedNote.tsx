import type { CSSProperties, ReactNode } from 'react';
import styles from './StoppedNote.module.css';

export interface StoppedNoteProps {
  /**
   * The note itself. Defaults to "Stopped — partial answer kept." Override to say what was actually
   * kept ("Stopped after 2 tools — partial answer kept"), never to add blame.
   */
  children?: ReactNode;
  /**
   * A trailing action, normally a `RetryButton` with `tone="neutral"`. Omit when there is nothing
   * useful to do — an action nobody wants is still a thing to read past.
   */
  action?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

/**
 * The inline note left behind when a user stops a generation.
 *
 * NEUTRAL BY DESIGN. Stopping is a normal, intentional act — often the correct one — so this reads
 * as muted text on a neutral fill with the same square mark the StopButton carries. It is not red,
 * not bordered in danger, has no error icon, and never says "failed", "aborted" or "cancelled".
 * `TurnError` is for the case where something went wrong; the two must be distinguishable at a
 * glance, because "I stopped it" and "it broke" call for completely different next actions.
 *
 * NOT A LIVE REGION — deliberately. The streaming surface already owns ONE polite live region that
 * announces transitions, and "Generation stopped" is one of them. Adding `role="status"` here would
 * announce the same event a second time, immediately after it. If your surface has no live region,
 * add one there rather than turning this note into one.
 *
 * KEYBOARD — the note is static text and takes no focus. Anything focusable inside it arrives via
 * `action`, and keeps its own keyboard contract.
 *
 * WHEN NOT TO USE IT
 * - A failed turn. That is `TurnError`, which is announced, coloured, and carries the underlying
 *   message. Dressing a failure up as a calm grey note hides it.
 * - A refused tool call. RBAC denying a tool is a tool-state, not a stopped generation.
 * - An empty answer that simply finished. Nothing was interrupted; render the answer's own empty
 *   state instead.
 * - As the ONLY record that the answer is incomplete, if the partial text also needs a truncation
 *   marker inline. This note sits after the text; it does not mark where the text stops.
 */
export function StoppedNote({
  children = 'Stopped — partial answer kept.',
  action,
  className,
  style,
}: StoppedNoteProps) {
  return (
    <div className={[styles.root, className].filter(Boolean).join(' ')} style={style}>
      {/* The same square mark as StopButton, muted. Shape carries the meaning so the note does not
          depend on its (deliberately quiet) colour to say what happened. */}
      <span className={styles.glyph} aria-hidden="true" />
      <span className={styles.text}>{children}</span>
      {action ? <span className={styles.action}>{action}</span> : null}
    </div>
  );
}
