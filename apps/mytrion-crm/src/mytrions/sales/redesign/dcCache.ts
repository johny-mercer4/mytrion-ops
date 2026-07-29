/**
 * Data Center client-side cache (stale-while-revalidate) — now a thin alias layer.
 *
 * The implementation moved to `mytrions/_shared/swrCache.ts` when HR needed it too (Manager's Loyalty
 * and Referrals cards had already been importing it from this sales folder, which is how it became
 * clear it was never Data-Center-specific). These re-exports keep every existing `readDcCache` /
 * `writeDcCache` / `invalidateDcCache` call site working, and — because they point at the same module
 * — there is still exactly one store: `invalidateDcCache('sales:leads')` cannot touch an `hr:*` key.
 *
 * Prefer importing from `_shared/swrCache` in new code.
 */
export {
  formatCachedAt,
  invalidateSwrCache as invalidateDcCache,
  readSwrCache as readDcCache,
  subscribeSwrCache as subscribeDcCache,
  useCachedLoad,
  writeSwrCache as writeDcCache,
  type CachedLoad,
} from '../../_shared/swrCache';
