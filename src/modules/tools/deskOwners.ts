/**
 * Ticket-owner enrichment for the Sales Desk dashboard. Some ticket payloads carry a bare
 * `assigneeId` without the nested `assignee{firstName,lastName}` object the UI renders (Desk's
 * `include`/`fields` embedding is inconsistent across the list vs search endpoints) — so a ticket
 * can have an owner with no displayable name. This fills the gap by joining assigneeId against
 * the same cached Desk agent roster CS analytics already uses (fetchDeskAgentRoster).
 */
import { fetchDeskAgentRoster } from '../customerService/csAnalyticsScope.js';

function hasAssigneeName(t: Record<string, unknown>): boolean {
  const a = t.assignee;
  if (!a || typeof a !== 'object') return false;
  const o = a as Record<string, unknown>;
  return Boolean(
    (typeof o.firstName === 'string' && o.firstName) ||
      (typeof o.lastName === 'string' && o.lastName) ||
      (typeof o.name === 'string' && o.name),
  );
}

/**
 * Fill in `assignee: {name}` from the Desk agent roster wherever a ticket has an assigneeId but
 * no embedded assignee name. Escalations (team-owned) are untouched — the UI only reads
 * `assignee` for non-escalation tickets. Best-effort: a roster fetch failure leaves tickets
 * exactly as Desk returned them.
 */
export async function enrichTicketOwners(
  tickets: Record<string, unknown>[],
): Promise<Record<string, unknown>[]> {
  const needsResolve = tickets.some((t) => !hasAssigneeName(t) && t.assigneeId != null && t.assigneeId !== '');
  if (!needsResolve) return tickets;
  const roster = await fetchDeskAgentRoster().catch(() => []);
  if (!roster.length) return tickets;
  const byId = new Map(roster.map((a) => [a.id, a]));
  return tickets.map((t) => {
    if (hasAssigneeName(t)) return t;
    const id = t.assigneeId != null ? String(t.assigneeId) : '';
    const name = id ? byId.get(id)?.name : null;
    return name ? { ...t, assignee: { name } } : t;
  });
}
