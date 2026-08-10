import { forwardRef, type HTMLAttributes } from 'react';
import { Icon, type IconName } from '../Icon/Icon';
import styles from './AgentBadge.module.css';

export type AgentBadgeSize = 'sm' | 'md';

export interface AgentBadgeProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  /** Display name of the agent being credited — "Sales", "Collection". Already human-readable. */
  agent: string;
  /**
   * The delegation trail that led here, oldest first and EXCLUDING `agent` itself. Given, the badge
   * renders the hand-off: `Orchestrator → Sales → agent`. Omit or pass `[]` for a single agent.
   *
   * A hand-off is worth showing because it answers the question people actually ask of an answer
   * they distrust — not "was an agent involved" but "which one, and who sent it there".
   */
  handoffFrom?: readonly string[];
  /** Optional leading glyph. There is no default: a robot icon on every message is decoration. */
  icon?: IconName;
  /** `md` sits above a message. `sm` fits a chip row or a table cell. */
  size?: AgentBadgeSize;
}

/**
 * Attribution: which agent produced this. A quiet neutral chip, not a status.
 *
 * It is deliberately the least loud thing in the AI layer. Attribution appears on every assistant
 * message in a transcript, so anything with real colour weight would turn the transcript into a
 * stripe of badges and drown the answers it is annotating. Neutral tokens, one border, no fill
 * beyond the surface tint.
 *
 * HAND-OFF — with `handoffFrom`, the chip becomes a trail: each preceding agent, an arrow, then the
 * agent that answered. Only the arrows and the trailing names take `--agent-handoff-fg`; the final
 * agent stays in the badge's own colour, so the eye lands on WHO ANSWERED and the route reads as
 * context around it. The arrows are `aria-hidden` and each carries the visually-hidden words
 * "handed off to", so a screen reader hears "Orchestrator handed off to Sales" rather than a name
 * salad — meaning is never left to a glyph any more than it is left to a colour.
 *
 * KEYBOARD — none. It is a label, not a control: not focusable, no keys. If the trail needs to be
 * expandable or linked to a trace, wrap it in a `Button` rather than making this chip clickable —
 * a focusable element whose only job is to display a name is a tab stop that costs more than it
 * gives.
 *
 * WHEN NOT TO USE IT
 * - For state. "Thinking", "Running tools", "Failed" are `AgentStatus`; this says WHO, never WHAT.
 * - For the human author of a message. That is an avatar and a name, from the user record.
 * - As a filter control or a removable token — that is a chip/tag component with an affordance.
 * - On every row of a list where the agent is the same for all of them. Put it in the header once.
 */
export const AgentBadge = forwardRef<HTMLSpanElement, AgentBadgeProps>(function AgentBadge(
  { agent, handoffFrom, icon, size = 'md', className, ...rest },
  ref,
) {
  const trail = handoffFrom ?? [];
  const handoff = trail.length > 0;

  return (
    <span
      ref={ref}
      className={[styles.root, className].filter(Boolean).join(' ')}
      data-size={size}
      data-handoff={handoff || undefined}
      {...rest}
    >
      {icon ? (
        <span className={styles.icon}>
          <Icon name={icon} size="sm" />
        </span>
      ) : null}
      {trail.map((step, i) => (
        // Keyed on position as well as name: the same agent can legitimately appear twice in a
        // trail (delegated out and back), so the name alone is not an identity. The trail is an
        // ordered, append-only path — index is a stable key for it, not the usual anti-pattern.
        <span key={`${i}-${step}`} className={styles.step}>
          <span className={styles.from}>{step}</span>
          <span className={styles.arrow}>
            <Icon name="arrow_forward" size="sm" />
          </span>
          {/* The arrow's meaning, in words, for anyone not seeing the arrow. */}
          <span className={styles.srOnly}> handed off to </span>
        </span>
      ))}
      <span className={styles.name}>{agent}</span>
    </span>
  );
});
