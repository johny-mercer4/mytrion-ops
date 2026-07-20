/**
 * RingCentral Embeddable bootstrap for Sales Mytrion — fetches adapter credentials from the
 * ops backend (secrets never live in VITE_*).
 */
import { request } from './transport';

// LEGACY assertion — ignored server-side for signed-in users (session-authoritative access);
// kept only for the FF_SESSION_DEPT_AUTHORITATIVE=0 rollback. Remove together with the flag.
const SALES_HEADERS = { 'x-department-access': 'sales' } as const;

export interface RingCentralEmbedConfig {
  enabled: boolean;
  clientId: string;
  serverUrl: string;
  /** Full adapter.js URL including clientId/secret/jwt query params. */
  adapterUrl: string;
}

export async function fetchRingCentralEmbedConfig(): Promise<RingCentralEmbedConfig> {
  return (await request('GET', '/ringcentral/embed-config', {
    headers: SALES_HEADERS,
  })) as RingCentralEmbedConfig;
}

/** A normalized RingCentral call-lifecycle event (kept in sync with callEventSchema on the backend). */
export interface RingCentralCallEventPayload {
  kind: 'ringing' | 'connected' | 'ended' | 'login' | 'logout';
  sessionId?: string;
  direction?: 'Inbound' | 'Outbound';
  from?: string;
  to?: string;
  telephonyStatus?: string;
  result?: string;
  startTime?: string;
  durationMs?: number;
  /** CRM correlation — the Data Center lead/deal this call was dialed from (outbound only). */
  leadId?: string;
  dealId?: string;
}

/**
 * Forward one call-lifecycle event to the ops backend for the audit trail ("which number, when,
 * how it ended"). The softphone bridge calls this for every event, so callers must swallow errors —
 * a logging hiccup must never surface to the agent mid-call.
 */
export async function postRingCentralCallEvent(payload: RingCentralCallEventPayload): Promise<void> {
  await request('POST', '/ringcentral/call-events', {
    headers: SALES_HEADERS,
    body: payload,
  });
}
