import { forwardRef, useEffect, useRef, useState, type HTMLAttributes } from 'react';
import { Icon, type IconName } from '../Icon/Icon';
import styles from './AgentStatus.module.css';

/**
 * The six states a turn can be in, mapped from what the runtime already reports — not invented.
 * `tool-running` is separate from `thinking` because they answer different questions: one is "the
 * model is composing", the other is "something is reaching out to a system of record", and only the
 * second one can be slow for a reason the user could act on.
 */
export type AgentState = 'idle' | 'thinking' | 'streaming' | 'tool-running' | 'done' | 'error';

export type AgentStatusSize = 'sm' | 'md';

/** Default wording per state. A caller can override `label`, but never remove it — see the docblock. */
const DEFAULT_LABEL: Record<AgentState, string> = {
  idle: 'Idle',
  thinking: 'Thinking',
  streaming: 'Answering',
  'tool-running': 'Running tools',
  done: 'Done',
  error: 'Error',
};

/**
 * The glyph per state, where a glyph is right. `idle`, `thinking` and `streaming` are DOTS with
 * three different treatments (hollow ring / filled / filled-with-halo); the three terminal-ish
 * states are icons, so the silhouette alone separates "in progress" from "settled".
 */
const ICON: Partial<Record<AgentState, IconName>> = {
  'tool-running': 'progress_activity',
  done: 'check_circle',
  error: 'error',
};

export interface AgentStatusProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /** Which state the turn is in. Drives the shape, the colour, the label and the announcement. */
  state: AgentState;
  /**
   * Overrides the default wording — for a runtime that knows something more specific
   * ("Consulting Sales…", "Waiting on approval"). There is no way to hide the label: colour and
   * shape alone would leave the six states as six coloured dots.
   */
  label?: string;
  /**
   * Secondary text after the label: a tool name, a target, an elapsed hint. Rendered in the mono
   * face because in practice it is an identifier. Never put the state's meaning here.
   */
  detail?: string;
  /** `md` sits above a transcript. `sm` fits a table row or a dense header. */
  size?: AgentStatusSize;
  /**
   * Owns the surface's single polite live region. TRUE on the one status for a surface; FALSE on
   * every other instance. Two live regions on one screen is two screen readers talking over
   * each other.
   */
  live?: boolean;
  /**
   * Overrides the announced sentence when the visible label makes a poor spoken one — the classic
   * case being a count the label shows as a chip ("Ran 3 tools"). Empty string announces nothing.
   */
  announcement?: string;
}

/**
 * What the agent is doing right now: one dot (or glyph) and one label.
 *
 * THE LIVE REGION — the part almost everyone gets wrong
 * This component owns the ONE polite live region for a streaming surface, and it announces STATE
 * TRANSITIONS ONLY: "Thinking" → "Answering" → "Done". It does not announce tokens, it does not
 * announce a `label` that changes while the state holds, and it says nothing at all on mount (the
 * state a surface starts in is not news). A region that fires per token is a screen reader reading
 * gibberish continuously and is worse than announcing nothing — which is the reason `StreamingText`
 * has no region of its own and this component has the only one.
 *
 * NEVER COLOUR ALONE — every state carries its own words AND its own shape: a hollow ring (idle), a
 * filled dot (thinking), a dot with a halo (streaming), a rotating progress glyph (tool-running), a
 * check (done), an error glyph (error). Desaturate the screen and all six still read.
 *
 * MOTION — `thinking` is a slow ambient opacity pulse and `tool-running` a rotating glyph, both
 * indefinite loops floored above 1s so they read as ambient rather than stalled. `streaming` is
 * deliberately STILL: `StreamingText`'s caret is already moving on the same surface, and two
 * competing rhythms in one corner of the screen is noise. Under reduced motion the loops stop and
 * the states stay legible, because the words were always doing the work.
 *
 * KEYBOARD — none. This is a status output, not a control: not focusable, no keys. If you find
 * yourself wanting it clickable (to open a trace, to cancel), the control is a `Button` NEXT to it.
 *
 * WHEN NOT TO USE IT
 * - As the per-tool-call chip. One tool's lifecycle is `ToolCall`; this is the state of the whole
 *   turn. Rendering one of these per tool re-creates the "six coloured dots" problem it avoids.
 * - As a page or route loading indicator. It describes an agent, not a fetch; use a skeleton.
 * - More than one with `live` on a surface. Exactly one region, always.
 * - To attribute an answer to a named agent — that is `AgentBadge`.
 */
export const AgentStatus = forwardRef<HTMLDivElement, AgentStatusProps>(function AgentStatus(
  { state, label, detail, size = 'md', live = true, announcement, className, ...rest },
  ref,
) {
  const text = label ?? DEFAULT_LABEL[state];
  const icon = ICON[state];

  // TRANSITIONS ONLY. Keyed on `state` and nothing else: a `label` that ticks along during one
  // state ("Consulting Sales…" → "Consulting Collection…") is progress detail, not a transition,
  // and announcing every revision is how a live region turns into chatter.
  const [announced, setAnnounced] = useState('');
  const previous = useRef<AgentState | null>(null);
  const alternate = useRef(false);

  useEffect(() => {
    if (!live) return;
    // First render is not a transition. Record it and stay silent — otherwise every mounted
    // transcript greets the user with "Idle".
    if (previous.current === null) {
      previous.current = state;
      return;
    }
    if (previous.current === state) return;
    previous.current = state;

    // Settling back to idle is the absence of news; announcing it would end every turn with a
    // second, contentless utterance after "Done".
    const next = announcement ?? (state === 'idle' ? '' : text);

    // A live region whose text is REPLACED WITH THE SAME STRING is not re-announced — the node did
    // not observably change. That is not hypothetical here: thinking → tool-running → thinking is
    // an ordinary turn, and the second "Thinking" would be silent. Alternating a trailing
    // no-break space makes consecutive identical announcements textually distinct; it is not
    // spoken, and it is invisible in a region that never paints.
    alternate.current = !alternate.current;
    setAnnounced(next && alternate.current ? `${next}\u00a0` : next);
  }, [state, live, announcement, text]);

  return (
    <div
      ref={ref}
      className={[styles.root, className].filter(Boolean).join(' ')}
      data-state={state}
      data-size={size}
      {...rest}
    >
      {icon ? (
        // Wrapped rather than classed directly: the glyph's colour comes from `currentColor` and
        // its rotation belongs to the wrapper, so `Icon` keeps its no-styling-prop contract.
        // Decoration either way — the label beside it already names the state, and a labelled icon
        // would make a screen reader say it twice.
        <span className={styles.glyph}>
          <Icon name={icon} size="sm" />
        </span>
      ) : (
        <span className={styles.dot} aria-hidden="true" />
      )}
      <span className={styles.label}>{text}</span>
      {detail ? <span className={styles.detail}>{detail}</span> : null}

      {/* The region is mounted from the start and empty, not created when there is something to
          say: a live region inserted at the same moment as its text is frequently missed entirely,
          because the assistive tech never observed the node changing. */}
      {live ? (
        <span className={styles.srOnly} aria-live="polite" aria-atomic="true">
          {announced}
        </span>
      ) : null}
    </div>
  );
});
