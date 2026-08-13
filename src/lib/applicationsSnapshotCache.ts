/**
 * Dedicated SWR cache for the CS Applications full-dataset snapshot (the joined Applications+Deals
 * drain — see applicationsList.ts for the loader). Deliberately NOT the shared `touchpointReadCache`
 * (touchpointReadCache.ts):
 *   - that cache prunes at 500 entries (LRU) — cost-blind eviction could drop the one entry that
 *     costs ~10 COQL calls to rebuild;
 *   - its invalidation is tenant-wide and fires on EVERY write in the tenant (touchpoints.routes.ts)
 *     — an unrelated Sales/CS write would nuke this snapshot too;
 *   - it's keyed per user — ten CS agents would each independently drain identical data.
 *
 * One entry per tenant (both Apps/Clients tabs share it — the tab split is a one-line in-memory
 * predicate, not a query param). Stale-while-revalidate: past the soft TTL, serve the current
 * snapshot immediately and fire a background force-refresh — `AsyncSWRCache`'s own in-flight
 * coalescing makes concurrent callers during that refresh share one rebuild rather than stampeding.
 */
import { AsyncSWRCache } from './asyncSWRCache.js';

export interface ApplicationsSnapshot<TRow> {
  rows: TRow[];
  truncated: boolean;
}

const cache = new AsyncSWRCache(2);
const SOFT_TTL_MS = 5 * 60_000;
const HARD_TTL_MS = 30 * 60_000;
const STALE_IF_ERROR_MS = 30 * 60_000;

function snapshotKey(tenantId: string): string {
  return `${tenantId}:applications`;
}

/** Serves a fresh-or-soft-stale snapshot; past the hard TTL blocks on a real rebuild. */
export async function getApplicationsSnapshot<TRow>(
  tenantId: string,
  loader: () => Promise<ApplicationsSnapshot<TRow>>,
  opts: { force?: boolean } = {},
): Promise<{ data: ApplicationsSnapshot<TRow>; generatedAt: string }> {
  const key = snapshotKey(tenantId);
  const loadOpts = { ttlMs: HARD_TTL_MS, staleIfErrorMs: STALE_IF_ERROR_MS };
  const result = await cache.getOrLoad(key, loader, { ...loadOpts, force: opts.force === true });
  const ageMs = Date.now() - new Date(result.generatedAt).getTime();
  if (!opts.force && ageMs > SOFT_TTL_MS) {
    // Fire-and-forget background revalidation. A failure here just leaves the current (still
    // usable) snapshot in place for the next request to retry against.
    void cache.getOrLoad(key, loader, { ...loadOpts, force: true }).catch(() => undefined);
  }
  return { data: result.data as ApplicationsSnapshot<TRow>, generatedAt: result.generatedAt };
}

/**
 * Mutate an already-cached row in place — avoids a full re-drain on every single-field save.
 * Never throws; returns false (a no-op) if nothing is cached yet or `findRow` finds no match (e.g.
 * a record created since the last drain) — callers should fall back to
 * `invalidateApplicationsSnapshot` in that case so the next read picks it up.
 */
export function patchApplicationsSnapshotRow<TRow>(
  tenantId: string,
  findRow: (rows: TRow[]) => TRow | undefined,
  patch: (row: TRow) => void,
): boolean {
  const snapshot = cache.peek<ApplicationsSnapshot<TRow>>(snapshotKey(tenantId));
  if (!snapshot) return false;
  const row = findRow(snapshot.rows);
  if (!row) return false;
  patch(row);
  return true;
}

export function invalidateApplicationsSnapshot(tenantId: string): void {
  cache.invalidate(snapshotKey(tenantId));
}
