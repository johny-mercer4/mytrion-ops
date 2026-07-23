/**
 * Live servercrm-socket connection status, shared from the shell (which owns the single socket via
 * useSidebarBadges) to any tab that wants to reflect it — e.g. the Tickets "LIVE" indicator, so the
 * dot tells the truth (green when connected, muted while reconnecting) instead of being hardcoded.
 */
import { useSyncExternalStore } from 'react';

let connected = false;
const listeners = new Set<() => void>();

export function setSocketConnected(next: boolean): void {
  if (connected === next) return;
  connected = next;
  listeners.forEach((l) => l());
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
function snapshot(): boolean {
  return connected;
}

/** Reactive read of the servercrm socket's connected state. */
export function useSocketConnected(): boolean {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
