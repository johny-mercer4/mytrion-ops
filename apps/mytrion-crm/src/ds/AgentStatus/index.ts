/**
 * AgentStatus/ exports two symbols, so it carries a re-export (CONVENTIONS §1).
 *
 * AgentBadge lives beside AgentStatus rather than in its own folder because the two answer the two
 * halves of one question — WHAT the agent is doing, and WHICH agent it is — and they are almost
 * always rendered within a few pixels of each other, above the same message. Keeping them together
 * is also what stops the pair drifting: the status colours and the badge's neutral tone are a
 * deliberate contrast (state is loud, attribution is quiet), and that decision is only legible when
 * both files sit side by side.
 */

export { AgentStatus } from './AgentStatus';
export type { AgentStatusProps, AgentState, AgentStatusSize } from './AgentStatus';

export { AgentBadge } from './AgentBadge';
export type { AgentBadgeProps, AgentBadgeSize } from './AgentBadge';
