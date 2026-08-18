import { DEFAULT_TENANT_ID } from '../config/constants.js';
import type { TenantContext } from '../types/tenantContext.js';

/**
 * The Collection snapshots have no `tenant_id` (finder-owned, UNIQUE on carrier). A partner
 * tenant that happens to hold the `collection` department must not read Octane's debtor book.
 * Repos call this before every query and return empty / undefined when it is false.
 */
export function canReadCollectionSnapshot(ctx: TenantContext): boolean {
  return ctx.tenantId === DEFAULT_TENANT_ID;
}
