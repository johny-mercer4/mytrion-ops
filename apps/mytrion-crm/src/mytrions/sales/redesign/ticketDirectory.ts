/**
 * Full creator-scoped ticket set from the shell sidebar loader — same ids we WS-subscribe.
 * The Tickets tab only pages ~20 at a time; when a live comment lands on an older ticket,
 * promote uses this cache for an instant pin, then refreshes via GET /desk/tickets/:id.
 */
import type { TicketVM } from './live';

const byId = new Map<string, TicketVM>();

export function setTicketDirectory(tickets: TicketVM[]): void {
  byId.clear();
  for (const t of tickets) {
    if (t.id) byId.set(t.id, t);
  }
}

export function getCachedTicket(id: string): TicketVM | undefined {
  return byId.get(id.trim());
}

export function upsertCachedTicket(ticket: TicketVM): void {
  if (ticket.id) byId.set(ticket.id, ticket);
}
