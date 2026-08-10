import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import styles from './StreamingText.module.css';

/**
 * `streaming` — tokens are still arriving.
 * `done` — the turn completed on its own.
 * `partial` — neither: the stream ended without completing (Stop, an abort, a dropped socket).
 *   Derived, never passed. The text is kept, the caret is gone, and the caller decides whether to
 *   say why (that note is `StoppedNote`'s job, not this component's).
 */
export type StreamingTextState = 'streaming' | 'done' | 'partial';

export interface StreamingTextProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /**
   * The text so far. Grows between renders; whitespace and newlines are preserved, so a model that
   * emits `\n\n` gets a paragraph break without the caller pre-processing anything.
   */
  text: string;
  /** Tokens are still arriving: shows the caret and sets `aria-busy`. */
  streaming?: boolean;
  /** The turn finished cleanly. Ignored while `streaming` is true. */
  done?: boolean;
  /**
   * The markdown escape hatch. When present it renders INSTEAD of `text`, and the caret still
   * trails it — for callers that run the same string through a markdown renderer. Pass `text` as
   * well anyway: it is what the emptiness check reads.
   *
   * Note the caret sits after the last INLINE box, so a child whose last node is a block (a table,
   * a fenced block) puts the caret on the line below. That is correct and not worth fighting.
   */
  children?: ReactNode;
}

/**
 * Text that is arriving. A growing string plus a caret — and deliberately nothing else.
 *
 * WHY THERE IS NO TYPEWRITER EFFECT, WHICH IS THE OBVIOUS WRONG INSTINCT HERE
 * The reflex when building this is to split the string into characters and fade each one in. Do not.
 *   1. It is unreadable. At 60 tokens/sec that is hundreds of concurrently-animating spans, each
 *      changing opacity under the eye. Reading is a saccade back and forth over settled glyphs;
 *      characters that are still resolving defeat regression, so people read slower and re-read more.
 *   2. It is expensive in exactly the wrong place. Per-character spans turn one text node into
 *      thousands of boxes, and every token re-lays-out the paragraph. The frame budget during a
 *      stream belongs to the scroll container, not to decoration.
 *   3. It is a lie about latency. A typewriter that paces characters is SLOWER than the model; the
 *      product's whole claim is that the model is fast.
 * So: the text is one text node that React grows in place, already-painted characters are never
 * touched again, and the caret is the only thing moving. `text-wrap` is pinned to `wrap` while
 * streaming for the same reason — `balance`/`pretty` re-flow settled lines on every token.
 *
 * ACCESSIBILITY — this component has NO live region, on purpose. A polite region that updates per
 * token is a screen reader reciting fragments continuously, which is strictly worse than silence.
 * The surface gets ONE region, and `AgentStatus` owns it, announcing transitions ("Answering",
 * "Ran 3 tools", "Done"). All this component contributes is `aria-busy` while tokens arrive.
 *
 * KEYBOARD — none. It is text, not a control: no focus, no keys. Text selection works because
 * nothing here blocks it, which matters — people copy answers out of this box constantly.
 *
 * REDUCED MOTION — the caret stops blinking and stays SOLID. It does not disappear: the caret is
 * the only signal that output is still coming, and motion must never be the load-bearing part of a
 * signal.
 *
 * WHEN NOT TO USE IT
 * - Static, finished prose. A stored transcript message is just text; a component with a streaming
 *   state machine around it buys nothing.
 * - As a progress indicator on its own. An empty streaming box is a blinking caret and no context —
 *   pair it with `AgentStatus`, which says what is being waited on.
 * - For a value that merely updates often (a live counter, a ticking total). This is for
 *   token-by-token append; a caret next to a number that jumps is nonsense.
 * - To render markdown by itself. It renders plain text; pass a rendered tree as `children`.
 */
export const StreamingText = forwardRef<HTMLDivElement, StreamingTextProps>(function StreamingText(
  { text, streaming = false, done = false, children, className, ...rest },
  ref,
) {
  // Nothing to say and nothing coming: render no box at all. An empty element here would hold open
  // a line of vertical space in the transcript for every turn that produced no prose.
  if (!streaming && !text && !children) return null;

  const state: StreamingTextState = streaming ? 'streaming' : done ? 'done' : 'partial';

  return (
    <div
      ref={ref}
      className={[styles.root, className].filter(Boolean).join(' ')}
      data-state={state}
      // Marks the region as updating without announcing anything. This is the entire a11y surface
      // of this component — see the docblock.
      aria-busy={streaming || undefined}
      {...rest}
    >
      <span className={styles.body}>{children ?? text}</span>
      {/* Decoration, and hidden as such: a caret is a rendering of "still going", and the live
          region already says so in words. */}
      {streaming ? <span className={styles.caret} aria-hidden="true" /> : null}
    </div>
  );
});
