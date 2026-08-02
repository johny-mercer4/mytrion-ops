/**
 * Per-user set of My Tasks that have been opened (detail modal). Drives the sidebar badge:
 * count of `open` assignments the agent has never opened.
 */
import { useSyncExternalStore } from 'react';
import { getImpersonation } from '@/api/impersonation';
import { getSession } from '@/api/session';

const KEY_BASE = 'octane.sales.redesign.tasks.opened';
type OpenedSet = Record<string, boolean>;

function storageKey(): string {
  const uid = getImpersonation()?.zohoUserId ?? getSession()?.worker.zohoUserId ?? 'anon';
  return `${KEY_BASE}:${uid}`;
}

function load(key: string): OpenedSet {
  try {
    const ids = JSON.parse(localStorage.getItem(key) ?? '[]') as string[];
    const next: OpenedSet = {};
    for (const id of Array.isArray(ids) ? ids : []) next[String(id)] = true;
    return next;
  } catch {
    return {};
  }
}

let activeKey = storageKey();
let opened: OpenedSet = load(activeKey);
const listeners = new Set<() => void>();

function ensureKey(): void {
  const key = storageKey();
  if (key !== activeKey) {
    activeKey = key;
    opened = load(key);
  }
}

function commit(next: OpenedSet): void {
  opened = next;
  try {
    localStorage.setItem(
      activeKey,
      JSON.stringify(Object.keys(next).filter((id) => next[id]).slice(-1000)),
    );
  } catch {
    /* storage disabled */
  }
  listeners.forEach((listener) => listener());
}

/** Mark a task opened (detail modal). Clears it from the sidebar "new" badge. */
export function markTaskOpened(id: string): void {
  ensureKey();
  if (!id || opened[id]) return;
  commit({ ...opened, [id]: true });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshot(): OpenedSet {
  ensureKey();
  return opened;
}

export function useTaskOpened(): OpenedSet {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** New assignments = status `open` and never opened in the detail modal. */
export function countUnopenedTasks(
  tasks: Array<{ id: string; status: string }>,
  openedSet: OpenedSet,
): number {
  return tasks.reduce(
    (n, task) => (task.status === 'open' && !openedSet[task.id] ? n + 1 : n),
    0,
  );
}
