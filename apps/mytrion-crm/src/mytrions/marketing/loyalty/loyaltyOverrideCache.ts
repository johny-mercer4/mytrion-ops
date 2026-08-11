import type { LoyaltyClientOverride, LoyaltyRoster } from '../../../api/loyalty';
import {
  invalidateSwrCache,
  readSwrCache,
  writeSwrCache,
} from '../../_shared/swrCache';

export const MANAGER_LOYALTY_CACHE_KEY = 'mgr:loyalty:clients';
const SALES_CLIENT_CACHE_PREFIX = 'sales:clients:';

/**
 * Keep both Mytrions coherent after a Manager changes one client's loyalty controls.
 *
 * Manager's cached company roster is patched immediately, so leaving and reopening the card cannot
 * resurrect the old controls. Sales rosters are owner-scoped, so invalidating their prefix is safer
 * than guessing which agent owns the carrier; mounted Sales views refetch, and future navigation
 * cannot reuse a stale book.
 */
export function propagateLoyaltyOverride(
  carrierId: string,
  override: LoyaltyClientOverride | null,
): void {
  const managerRoster = readSwrCache<LoyaltyRoster>(MANAGER_LOYALTY_CACHE_KEY);
  if (managerRoster) {
    writeSwrCache<LoyaltyRoster>(MANAGER_LOYALTY_CACHE_KEY, {
      ...managerRoster.data,
      clients: managerRoster.data.clients.map((client) =>
        client.carrierId === carrierId ? { ...client, loyaltyOverride: override } : client,
      ),
    });
  }
  invalidateSwrCache(SALES_CLIENT_CACHE_PREFIX);
}
