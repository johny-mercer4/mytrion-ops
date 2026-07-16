/**
 * Shared inbox read-state — a persisted set of read message ids, so the Inbox tab (which marks
 * items read) and the sidebar badge (which shows the UNREAD count) stay in sync. Marking a message
 * read removes it from the unread count immediately; the reference self-service uses the same
 * localStorage-backed read set (`mytrion-inbox-read`) driving `unreadCount`.
 */
import { useSyncExternalStore } from 'react';
import { getImpersonation } from '@/api/impersonation';
import { getSession } from '@/api/session';

// User-scoped key: read state must not bleed across accounts on a shared machine, nor between
// an admin's own view and a View-as target. (The old un-suffixed key is simply abandoned.)
const KEY_BASE = 'octane.sales.redesign.inbox.read';
type ReadSet = Record<string, boolean>;

function storageKey(): string {
  const uid = getImpersonation()?.zohoUserId ?? getSession()?.worker.zohoUserId ?? 'anon';
  return `${KEY_BASE}:${uid}`;
}

function load(key: string): ReadSet {
  try {
    const ids = JSON.parse(localStorage.getItem(key) ?? '[]') as string[];
    const r: ReadSet = {};
    for (const id of Array.isArray(ids) ? ids : []) r[String(id)] = true;
    return r;
  } catch {
    return {};
  }
}

let activeKey = storageKey();
let read: ReadSet = load(activeKey);
const listeners = new Set<() => void>();

// Sign-in / View-as switches change the storage key mid-session — swap to that user's set.
// Consumers re-render on those switches (session/impersonation context), so no notify needed.
function ensureKey(): void {
  const key = storageKey();
  if (key !== activeKey) {
    activeKey = key;
    read = load(key);
  }
}

function commit(next: ReadSet): void {
  read = next;
  try {
    // Persist as an array, capped, matching the original format.
    localStorage.setItem(activeKey, JSON.stringify(Object.keys(next).filter((k) => next[k]).slice(-1000)));
  } catch {
    /* storage disabled */
  }
  listeners.forEach((l) => l());
}

/** Mark one message read. */
export function markInboxRead(id: string): void {
  ensureKey();
  if (!id || read[id]) return;
  commit({ ...read, [id]: true });
}

/** Mark many messages read (e.g. "Mark all read"). No-op if all already read. */
export function markInboxReadMany(ids: string[]): void {
  ensureKey();
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
  ensureKey();
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
