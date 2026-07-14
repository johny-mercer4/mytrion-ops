/**
 * Real-time unread tracking for the Sales tickets — a tiny external store (persisted to
 * localStorage) that both the sidebar badge (shell) and the per-row badges (Tickets tab) read.
 *
 * Ported from the reference ticketdashboard's `unreadCounts` model: a new `ticket_comment_added`
 * (or attachment) WebSocket event for one of the caller's tickets increments that ticket's count;
 * opening/selecting the ticket clears it. Unread is thus WS-driven (activity since last read),
 * never a server flag — exactly like the reference.
 */
import { useSyncExternalStore } from 'react';

const KEY = 'octane.sales.redesign.ticketUnread.v1';
type Counts = Record<string, number>;

function load(): Counts {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}') as unknown;
    return v && typeof v === 'object' ? (v as Counts) : {};
  } catch {
    return {};
  }
}

let counts: Counts = load();
const listeners = new Set<() => void>();

function commit(next: Counts): void {
  counts = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage disabled — the in-memory store still drives this tab */
  }
  listeners.forEach((l) => l());
}

/** A new message arrived for `ticketId` → bump its unread count. */
export function bumpTicketUnread(ticketId: string): void {
  if (!ticketId) return;
  commit({ ...counts, [ticketId]: (counts[ticketId] ?? 0) + 1 });
}

/** The ticket was opened/read → clear its unread count. */
export function clearTicketUnread(ticketId: string): void {
  if (!ticketId || !counts[ticketId]) return;
  const next = { ...counts };
  delete next[ticketId];
  commit(next);
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
function snapshot(): Counts {
  return counts;
}

/** Reactive read of the per-ticket unread map. */
export function useTicketUnread(): Counts {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** Total unread messages across all tickets (the sidebar badge value). */
export function totalTicketUnread(c: Counts): number {
  let t = 0;
  for (const k in c) t += c[k] ?? 0;
  return t;
}
