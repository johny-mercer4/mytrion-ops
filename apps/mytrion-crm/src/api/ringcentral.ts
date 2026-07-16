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
