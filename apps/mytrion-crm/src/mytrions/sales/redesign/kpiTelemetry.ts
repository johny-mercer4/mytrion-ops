import { useEffect } from 'react';
import {
  postKpiActivity,
  postKpiPresence,
  type KpiActivityEvent,
  type KpiActivityName,
} from '@/api/kpiTelemetry';

const SESSION_ID = typeof crypto !== 'undefined' && 'randomUUID' in crypto
  ? crypto.randomUUID()
  : `kpi-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const IDLE_AFTER_MS = 5 * 60_000;
let lastInteractionAt = Date.now();
let activityQueue: KpiActivityEvent[] = [];
let activityTimer: ReturnType<typeof setTimeout> | null = null;

function eventId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${SESSION_ID}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function flushActivity(): Promise<void> {
  activityTimer = null;
  const batch = activityQueue.splice(0, 100);
  if (!batch.length) return;
  try {
    await postKpiActivity(batch);
  } catch {
    activityQueue = [...batch, ...activityQueue].slice(0, 500);
  }
  if (activityQueue.length) activityTimer = setTimeout(() => void flushActivity(), 5_000);
}

export function emitKpiActivity(
  eventName: KpiActivityName,
  detail: Pick<KpiActivityEvent, 'entityType' | 'entityId' | 'outcome'> = {},
): void {
  activityQueue.push({
    clientEventId: eventId(),
    eventName,
    sessionId: SESSION_ID,
    occurredAt: new Date().toISOString(),
    ...detail,
  });
  if (!activityTimer) activityTimer = setTimeout(() => void flushActivity(), 750);
}

async function sendPresence(state: 'active' | 'idle' | 'hidden' | 'ended'): Promise<void> {
  try {
    await postKpiPresence(SESSION_ID, [
      { clientEventId: eventId(), state, occurredAt: new Date().toISOString() },
    ]);
  } catch {
    // Presence is best-effort telemetry and must never interrupt the worker's CRM flow.
  }
}

export function useKpiPresence(): void {
  useEffect(() => {
    const noteInteraction = (): void => {
      lastInteractionAt = Date.now();
    };
    const state = (): 'active' | 'idle' | 'hidden' => {
      if (document.visibilityState !== 'visible') return 'hidden';
      return Date.now() - lastInteractionAt <= IDLE_AFTER_MS ? 'active' : 'idle';
    };
    const heartbeat = (): void => {
      // One visibility event reports `hidden`; recurring presence traffic pauses until the tab is
      // visible again so an idle Sales session does not consume background network resources.
      if (document.visibilityState === 'visible') void sendPresence(state());
    };
    const onVisibility = (): void => {
      void sendPresence(state());
    };
    const onPageHide = (): void => void sendPresence('ended');
    const activityEvents: Array<keyof WindowEventMap> = ['pointerdown', 'keydown', 'scroll'];
    activityEvents.forEach((name) => window.addEventListener(name, noteInteraction, { passive: true }));
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    // Do not compete with Home + sidebar badge fan-out on the first tick (HTTP/2 refused streams).
    const first = window.setTimeout(heartbeat, 800);
    const timer = window.setInterval(heartbeat, 60_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
      activityEvents.forEach((name) => window.removeEventListener(name, noteInteraction));
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      void sendPresence('ended');
    };
  }, []);
}
