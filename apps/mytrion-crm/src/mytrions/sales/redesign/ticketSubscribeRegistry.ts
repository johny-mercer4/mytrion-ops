/**
 * Shared creator-scoped ticket id set for servercrm WS subscribe — same pattern as
 * zoho-octane ticketdashboard.html `userTicketIds` / `userTicketIdsSet`.
 *
 * The shell badges socket and the Tickets tab both read/write this registry so we never
 * page the entire Desk queue just to subscribe (that dump was starving the UI).
 */
import type { TicketVM } from './live';

type Listener = () => void;

const byId = new Map<string, TicketVM>();
const listeners = new Set<Listener>();
let actorKey = 'self';

function notify(): void {
  for (const fn of [...listeners]) fn();
}

export function setTicketSubscribeActor(key: string): void {
  const next = key.trim() || 'self';
  if (next === actorKey) return;
  actorKey = next;
  byId.clear();
  notify();
}

export function getTicketSubscribeActor(): string {
  return actorKey;
}

/** Merge tickets into the subscribe set (progressive pages + first-page shell warm). */
export function upsertTicketSubscribeRows(tickets: TicketVM[]): void {
  let changed = false;
  for (const t of tickets) {
    const id = t.id?.trim();
    if (!id) continue;
    const prev = byId.get(id);
    if (!prev || prev !== t) {
      byId.set(id, t);
      changed = true;
    }
  }
  if (changed) notify();
}

export function getTicketSubscribeIds(): string[] {
  return [...byId.keys()];
}

export function getTicketSubscribeRows(): TicketVM[] {
  return [...byId.values()];
}

export function findSubscribedTicket(id: string): TicketVM | undefined {
  return byId.get(id.trim());
}

export function subscribeTicketIds(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
