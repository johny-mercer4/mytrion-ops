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
import { getImpersonation } from '@/api/impersonation';
import { getSession } from '@/api/session';

// User-scoped key: unread counts must not bleed across accounts on a shared machine, nor
// between an admin's own view and a View-as target (the old un-suffixed key is abandoned).
const KEY_BASE = 'octane.sales.redesign.ticketUnread.v1';
type Counts = Record<string, number>;

function storageKey(): string {
  const uid = getImpersonation()?.zohoUserId ?? getSession()?.worker.zohoUserId ?? 'anon';
  return `${KEY_BASE}:${uid}`;
}

function load(key: string): Counts {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? '{}') as unknown;
    return v && typeof v === 'object' ? (v as Counts) : {};
  } catch {
    return {};
  }
}

let activeKey = storageKey();
let counts: Counts = load(activeKey);
const listeners = new Set<() => void>();

// Sign-in / View-as switches change the storage key mid-session — swap to that user's counts.
function ensureKey(): void {
  const key = storageKey();
  if (key !== activeKey) {
    activeKey = key;
    counts = load(key);
  }
}

function commit(next: Counts): void {
  counts = next;
  try {
    localStorage.setItem(activeKey, JSON.stringify(next));
  } catch {
    /* storage disabled — the in-memory store still drives this tab */
  }
  listeners.forEach((l) => l());
}

/** A new message arrived for `ticketId` → bump its unread count. */
export function bumpTicketUnread(ticketId: string): void {
  if (!ticketId) return;
  ensureKey();
  commit({ ...counts, [ticketId]: (counts[ticketId] ?? 0) + 1 });
}

/** The ticket was opened/read → clear its unread count. */
export function clearTicketUnread(ticketId: string): void {
  ensureKey();
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
  ensureKey();
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
