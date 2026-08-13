/**
 * The shared SWR cache backing every `riskClass: 'read'` touchpoint (see touchpoints.routes.ts).
 * Lives here, not in the routes file, so write-side modules whose data a read touchpoint mirrors
 * (e.g. applicationsSave.ts writing what cs.applications.list reads) can invalidate it after a
 * successful write without importing a routes file.
 */
import { AsyncSWRCache } from './asyncSWRCache.js';

export const touchpointReadCache = new AsyncSWRCache(500);
export const TOUCHPOINT_READ_TTL_MS = 90_000;
export const TOUCHPOINT_READ_STALE_MS = 10 * 60_000;

/** Drop every cached read for a tenant — the same blunt invalidation touchpoint mutations trigger. */
export function invalidateTouchpointReadCache(tenantId: string): void {
  touchpointReadCache.invalidate(`${tenantId}:`);
}
