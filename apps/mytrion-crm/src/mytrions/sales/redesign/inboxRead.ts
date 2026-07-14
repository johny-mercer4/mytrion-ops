/**
 * Shared inbox read-state — a persisted set of read message ids, so the Inbox tab (which marks
 * items read) and the sidebar badge (which shows the UNREAD count) stay in sync. Marking a message
 * read removes it from the unread count immediately; the reference self-service uses the same
 * localStorage-backed read set (`mytrion-inbox-read`) driving `unreadCount`.
 */
import { useSyncExternalStore } from 'react';

// Same key the InboxTab has always used, so prior read state carries over.
const KEY = 'octane.sales.redesign.inbox.read';
type ReadSet = Record<string, boolean>;

function load(): ReadSet {
  try {
    const ids = JSON.parse(localStorage.getItem(KEY) ?? '[]') as string[];
    const r: ReadSet = {};
    for (const id of Array.isArray(ids) ? ids : []) r[String(id)] = true;
    return r;
  } catch {
    return {};
  }
}

let read: ReadSet = load();
const listeners = new Set<() => void>();

function commit(next: ReadSet): void {
  read = next;
  try {
    // Persist as an array, capped, matching the original format.
    localStorage.setItem(KEY, JSON.stringify(Object.keys(next).filter((k) => next[k]).slice(-1000)));
  } catch {
    /* storage disabled */
  }
  listeners.forEach((l) => l());
}

/** Mark one message read. */
export function markInboxRead(id: string): void {
  if (!id || read[id]) return;
  commit({ ...read, [id]: true });
}

/** Mark many messages read (e.g. "Mark all read"). No-op if all already read. */
export function markInboxReadMany(ids: string[]): void {
  const next = { ...read };
  let changed = false;
  for (const id of ids) {
    if (id && !next[id]) {
      next[id] = true;
      changed = true;
    }
  }
  if (changed) commit(next);
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
function snapshot(): ReadSet {
  return read;
}

/** Reactive read of the read-id set. */
export function useInboxRead(): ReadSet {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** Count of unread items given the current read set. */
export function countUnread<T extends { id: string }>(items: T[], readSet: ReadSet): number {
  return items.reduce((n, i) => (readSet[i.id] ? n : n + 1), 0);
}
