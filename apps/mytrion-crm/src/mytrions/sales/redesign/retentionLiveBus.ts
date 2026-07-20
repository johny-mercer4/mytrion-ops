/**
 * In-app bus for Octane retention realtime frames — Shell publishes; Retention
 * Cases / Pool panes subscribe to refresh immediately.
 */

export interface RetentionLivePayload {
  type: string;
  ownerId: string;
  title: string;
  detail: string | null;
  caseId: string | null;
}

type Handler = (payload: RetentionLivePayload) => void;
const handlers = new Set<Handler>();

export function subscribeRetentionLive(handler: Handler): () => void {
  handlers.add(handler);
  return () => {
    handlers.delete(handler);
  };
}

export function publishRetentionLive(payload: RetentionLivePayload): void {
  handlers.forEach((h) => h(payload));
}

/** Pull caseId=… from notify detail strings. */
export function parseRetentionCaseId(detail: string | null | undefined): string | null {
  if (!detail) return null;
  const m = /caseId=([A-Za-z0-9_-]+)/.exec(detail);
  return m?.[1] ?? null;
}
