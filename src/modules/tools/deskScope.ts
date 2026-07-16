/**
 * Owner-scoping for per-ticket Desk routes. The ticket LIST is creator-scoped
 * (cf_crm_created_by_id via searchTicketsByCreator), but ticket ids are guessable — comments,
 * replies and attachment downloads must re-check that the target ticket belongs to the caller
 * (IDOR guard). Mirrors serverCrmScope.assertCarrierOwned: admins / act-as / bypass skip;
 * everyone else is locked to tickets they created.
 */
import { NotFoundError, RBACError } from '../../lib/errors.js';
import { getTicket } from '../../integrations/zohoDesk.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { resolveZohoUserId } from './serverCrmScope.js';

// A ticket's creator is immutable, and the conversation pane polls — cache the creator id so
// the ownership check costs one Desk GET per ticket per TTL, not per request.
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX = 500;
const creatorCache = new Map<string, { creator: string; expiresAt: number }>();

function cachedCreator(ticketId: string): string | null {
  const hit = creatorCache.get(ticketId);
  if (!hit) return null;
  if (hit.expiresAt < Date.now()) {
    creatorCache.delete(ticketId);
    return null;
  }
  return hit.creator;
}

function cacheCreator(ticketId: string, creator: string): void {
  if (creatorCache.size >= CACHE_MAX) {
    const oldest = creatorCache.keys().next().value;
    if (oldest !== undefined) creatorCache.delete(oldest);
  }
  creatorCache.set(ticketId, { creator, expiresAt: Date.now() + CACHE_TTL_MS });
}

/** Test hook: drop all cached creator ids. */
export function clearTicketOwnerCache(): void {
  creatorCache.clear();
}

/**
 * Assert the caller created this Desk ticket. Admin / all-department / bypass callers pass
 * (act-as contexts carry the TARGET's identity, so a non-admin target is checked as themselves).
 * Unknown ticket → 404; someone else's ticket (or a pre-stamping ticket with no creator id,
 * which never appears in a rep's list anyway) → 403.
 */
export async function assertTicketOwned(ctx: TenantContext, ticketId: string): Promise<void> {
  if (ctx.allDepartmentAccess || ctx.bypassRbac || ctx.role === 'admin') return;
  const self = resolveZohoUserId(ctx);
  let creator = cachedCreator(ticketId);
  if (creator === null) {
    let ticket: Record<string, unknown>;
    try {
      ticket = await getTicket(ticketId);
    } catch (err) {
      if (err instanceof Error && /HTTP 404/.test(err.message)) {
        throw new NotFoundError('Ticket not found');
      }
      throw err;
    }
    const cf = (ticket.cf ?? {}) as Record<string, unknown>;
    creator = String(cf.cf_crm_created_by_id ?? '');
    cacheCreator(ticketId, creator);
  }
  if (!creator || creator !== self) {
    throw new RBACError('This ticket is not yours — you can only access your own tickets.');
  }
}
