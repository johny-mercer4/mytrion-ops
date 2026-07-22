/**
 * In-app bus for CS Retention realtime — Shell publishes; Claims / Cases / CITI subscribe.
 */

export interface CsRetentionLivePayload {
  type: string;
  title: string;
  detail: string | null;
}

type Handler = (payload: CsRetentionLivePayload) => void;
const handlers = new Set<Handler>();

export function subscribeCsRetentionLive(handler: Handler): () => void {
  handlers.add(handler);
  return () => {
    handlers.delete(handler);
  };
}

export function publishCsRetentionLive(payload: CsRetentionLivePayload): void {
  handlers.forEach((h) => h(payload));
}
