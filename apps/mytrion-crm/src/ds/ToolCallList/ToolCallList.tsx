import type { CSSProperties } from 'react';
import {
  ToolCallCard,
  ToolCallStatusGlyph,
  TOOL_CALL_STATUS_LABEL,
  type ToolCallCardProps,
  type ToolCallStatus,
} from '../ToolCallCard/ToolCallCard';
import styles from './ToolCallList.module.css';

export interface ToolCallListItem extends Omit<ToolCallCardProps, 'railed' | 'className' | 'style'> {
  /** Stable React key. Fall back to name + position only when the runtime has no call id. */
  id?: string;
}

export interface ToolCallListProps {
  calls: ToolCallListItem[];
  /** Accessible name for the timeline. Give it a scope when a turn has more than one list. */
  label?: string;
  /**
   * Opt in to ONE polite live region for the whole list, announcing transitions only — "Running
   * dwh_query", "Ran 3 tools, 1 not permitted". Leave it OFF (the default) inside a chat panel that
   * already owns the surface's single live region: two regions on one streaming surface interrupt
   * each other, and the result is worse than silence.
   */
  announce?: boolean;
  className?: string;
  style?: CSSProperties;
}

const SETTLED: ReadonlySet<ToolCallStatus> = new Set<ToolCallStatus>(['ok', 'error', 'denied']);

/** Class-name join; also the bridge from a CSS-module lookup (`string | undefined`) to `className`. */
const cx = (...parts: Array<string | false | undefined>): string => parts.filter(Boolean).join(' ');

/**
 * The announcement string. It is derived from the calls, so it changes exactly when the run's SHAPE
 * changes — a new tool starts, or everything settles. It never changes per token and never per
 * payload byte, which is the whole discipline: a live region that fires continuously reads as
 * gibberish and is worse than no announcement at all.
 */
function announcement(calls: ToolCallListItem[]): string {
  if (calls.length === 0) return '';
  const running = calls.find((c) => c.status === 'running');
  if (running) return `Running ${running.name}`;
  const settled = calls.filter((c) => SETTLED.has(c.status));
  if (settled.length < calls.length) return '';
  const failed = settled.filter((c) => c.status === 'error').length;
  const denied = settled.filter((c) => c.status === 'denied').length;
  const parts = [`Ran ${settled.length} ${settled.length === 1 ? 'tool' : 'tools'}`];
  if (failed > 0) parts.push(`${failed} failed`);
  // Never folded into the failure count. A refusal is not an outage.
  if (denied > 0) parts.push(`${denied} not permitted`);
  return parts.join(', ');
}

/**
 * A turn's tool calls as a dense vertical timeline: a rail (`--trace-rail`) connecting one status
 * node per call, each node opening into a `ToolCallCard`.
 *
 * IT IS A TIMELINE, NOT A TABLE. Order is the information — which tool ran first, which one is still
 * going, where the run stopped. The rail is what makes that readable at a glance; without it a stack
 * of cards is just a stack of cards.
 *
 * THE NODE IS THE STATUS MARK. The list owns it, so the cards render with `railed` and drop their
 * own glyph rather than printing the same state twice on every row. Node colour comes from
 * `--trace-node-*`, except `denied`, which has no trace token because the trace layer only knows
 * running/ok/error — it takes `--tool-denied-fg`, and that gap is the reason this list maps status
 * explicitly instead of passing the trace status through.
 *
 * KEYBOARD — nothing of its own. Tab walks the cards' disclosures in run order and Enter/Space
 * toggles them; the list adds no roving tabindex, because a timeline of independent disclosures is
 * not a composite widget and hijacking the arrow keys would break the page's own scrolling.
 *
 * WHEN NOT TO USE IT
 * - A single tool call. Render one `ToolCallCard`; a rail with one node is decoration.
 * - The runtime trace of a turn (route → model → rag → verification). That is TurnInspector.
 * - A summary of what an answer used, inline in a message header — that is a row of chips.
 * - Long tool histories across many turns. This renders every call it is given; page or virtualise
 *   upstream rather than mounting five hundred disclosures.
 */
export function ToolCallList({ calls, label = 'Tool calls', announce = false, className, style }: ToolCallListProps) {
  if (calls.length === 0) return null;
  const live = announce ? announcement(calls) : '';

  return (
    <div className={cx(styles.root, className)} style={style}>
      <ol className={styles.list} aria-label={label}>
        {calls.map(({ id, ...call }, index) => (
          <li className={styles.item} key={id ?? `${call.name}-${index}`} data-status={call.status}>
            <span className={styles.node}>
              {/* The node carries the accessible name for the state; the card's header repeats it in
                  its own screen-reader sentence, so neither one is the only source. */}
              <ToolCallStatusGlyph status={call.status} label={TOOL_CALL_STATUS_LABEL[call.status]} />
            </span>
            <ToolCallCard {...call} railed className={cx(styles.card)} />
          </li>
        ))}
      </ol>
      {announce ? (
        <p className={styles.srOnly} aria-live="polite">
          {live}
        </p>
      ) : null}
    </div>
  );
}
