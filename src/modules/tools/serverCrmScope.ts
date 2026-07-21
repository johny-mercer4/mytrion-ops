/**
 * Owner-scoping for servercrm agent-API tools. servercrm scopes data by the agent identity we
 * pass (agentName → carrier roster, or a zoho user id). We bind that to the CALLER:
 *  - Administrator (allDepartmentAccess): may target any agent (optional override), else self.
 *  - Everyone else: locked to their own identity (the Zoho context on the request).
 *
 * The carrier-ownership GATE (`assertCarrierOwned`) resolves against the DWH roster
 * (`dwhClientRoster.isCarrierOwned` — id-suffix arm, else name arm), the same authority that
 * feeds the Clients tab, so "listed" and "actionable" can never diverge. servercrm's by-agent
 * endpoint is NOT consulted for the gate: it keys on the full session id, which does not line
 * up with the warehouse id space (see dwhClientRoster.ts header) — that divergence 403'd the
 * Clients modal for every non-admin.
 */
import { AppError, RBACError, ToolError } from '../../lib/errors.js';
import { isCarrierOwned, zohoIdSuffix } from '../../integrations/dwhClientRoster.js';
import { serverCrmGet } from '../../integrations/serverCrm.js';
import type { TenantContext } from '../../types/tenantContext.js';

/** The caller's raw Zoho user id (chat sets ctx.userId = `zoho:<id>`), or null. */
function callerZohoUserId(ctx: TenantContext): string | null {
  const match = /^zoho:(.+)$/.exec(ctx.userId);
  return match?.[1] ?? null;
}

/** Resolve the agentName to query servercrm with (caller's name; admins may override). */
export function resolveAgentName(ctx: TenantContext, override?: string): string {
  const self = ctx.userName?.trim();
  if (ctx.allDepartmentAccess) {
    const name = override?.trim() || self;
    if (!name) throw new ToolError('agentName is required (no caller name on the request)');
    return name;
  }
  if (!self) {
    throw new ToolError('No agent identity (user_name) on the request for owner-scoped data');
  }
  return self;
}

/** Resolve the zoho user id to query servercrm with (caller's id; admins may override). */
export function resolveZohoUserId(ctx: TenantContext, override?: string): string {
  const self = callerZohoUserId(ctx);
  if (ctx.allDepartmentAccess) {
    const id = override?.trim() || self;
    if (!id) throw new ToolError('zohoUserId is required (no caller id on the request)');
    return id;
  }
  if (!self) {
    throw new ToolError('No Zoho user id on the request for owner-scoped data');
  }
  return self;
}

export interface RosterCarrier {
  carrierId: number;
  companyName: string;
  paymentTerms: string | null;
  isActive: boolean | null;
  isDebtor: boolean | null;
}

interface ByAgentResponse {
  agent_name?: string | null;
  data?: Array<{
    carrier_id?: number | string;
    company_name?: string;
    payment_terms?: string | null;
    is_active?: boolean | number | string | null;
    is_debtor?: boolean | number | string | null;
  }>;
}

/** servercrm/DWH returns booleans as 0/1 (or "t"/"f") — normalize to a real boolean or null. */
function toBool(v: boolean | number | string | null | undefined): boolean | null {
  if (v == null) return null;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  return ['1', 'true', 'yes', 't', 'y'].includes(String(v).trim().toLowerCase());
}

/**
 * The caller's own client roster (owner-scoped), from servercrm's by-agent endpoint. Admins may
 * target another agent via `override` (their zoho user id). Used to feed the "pick your client"
 * choice and to gate carrier-scoped actions.
 */
export async function fetchAgentRoster(
  ctx: TenantContext,
  opts: { search?: string; override?: string; limit?: number } = {},
): Promise<{ agentName: string | null; zohoUserId: string; carriers: RosterCarrier[] }> {
  const zohoUserId = resolveZohoUserId(ctx, opts.override);
  const res = await serverCrmGet<ByAgentResponse>(
    `/api/clients/by-agent/${encodeURIComponent(zohoUserId)}`,
    { limit: opts.limit ?? 200, ...(opts.search ? { search: opts.search } : {}) },
  );
  const carriers: RosterCarrier[] = (res.data ?? [])
    .filter((c) => c.carrier_id !== undefined && c.carrier_id !== null)
    .map((c) => ({
      carrierId: Number(c.carrier_id),
      companyName: c.company_name ?? '(unnamed)',
      paymentTerms: c.payment_terms ?? null,
      isActive: toBool(c.is_active),
      isDebtor: toBool(c.is_debtor),
    }));
  return { agentName: res.agent_name ?? null, zohoUserId, carriers };
}

// Ownership is stable minute-to-minute and the Clients modal fires several carrier-gated calls
// per open (cards + transactions + Load-more) — cache probe results, coalescing concurrent
// lookups. Negative results are cached too: a denied carrier must not turn retries into a DWH
// hammer. TTL matches mytrionAccessService's access-resolution cache class.
const OWNED_TTL_MS = 60_000;
const OWNED_CACHE_MAX = 1000;
const ownedCache = new Map<string, { value: boolean; expiresAt: number }>();
const ownedInflight = new Map<string, Promise<boolean>>();

/** Test hook: drop all cached ownership results. */
export function clearCarrierOwnershipCache(): void {
  ownedCache.clear();
  ownedInflight.clear();
}

/** Cache key on the NORMALIZED identity (id suffix + lowercased name) — the arms the SQL matches on. */
function ownedKey(tenantId: string, ownerId: string, ownerName: string | undefined, carrierId: string): string {
  return [tenantId, zohoIdSuffix(ownerId), (ownerName ?? '').toLowerCase(), carrierId].join('|');
}

async function carrierOwnedCached(
  tenantId: string,
  ownerId: string,
  ownerName: string | undefined,
  carrierId: string,
): Promise<boolean> {
  const key = ownedKey(tenantId, ownerId, ownerName, carrierId);
  const hit = ownedCache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  const pending = ownedInflight.get(key);
  if (pending) return pending;
  const probe = isCarrierOwned(ownerId, ownerName, carrierId)
    .then((value) => {
      if (ownedCache.size >= OWNED_CACHE_MAX) {
        const oldest = ownedCache.keys().next().value;
        if (oldest !== undefined) ownedCache.delete(oldest);
      }
      ownedCache.set(key, { value, expiresAt: Date.now() + OWNED_TTL_MS });
      return value;
    })
    .finally(() => ownedInflight.delete(key)); // errors are never cached — next call re-probes
  ownedInflight.set(key, probe);
  return probe;
}

/**
 * Enforce owner-scoping on a carrier-keyed action: a non-admin caller may only touch carriers in
 * their own roster. servercrm does NOT check this — it's OUR responsibility. Admins / bypass skip
 * (act-as contexts carry the TARGET's id + directory-verified name, so a non-admin target is
 * checked as themselves). Ownership = the DWH roster probe (see file header). A DWH outage is a
 * 502, never an RBAC denial — the touchpoint audit trail must record policy, not infrastructure.
 */
export async function assertCarrierOwned(ctx: TenantContext, carrierId: number | string): Promise<void> {
  if (ctx.allDepartmentAccess || ctx.bypassRbac) return;
  const ownerId = callerZohoUserId(ctx) ?? '';
  const ownerName = ctx.userName?.trim() || undefined;
  if (!zohoIdSuffix(ownerId) && !ownerName) {
    throw new ToolError('No agent identity (zoho user id or user_name) on the request for owner-scoped data');
  }
  let owned: boolean;
  try {
    owned = await carrierOwnedCached(ctx.tenantId, ownerId, ownerName, String(carrierId).trim());
  } catch (err) {
    throw new AppError('Ownership check unavailable (data warehouse)', {
      statusCode: 502,
      code: 'DWH_ERROR',
      expose: true,
      cause: err,
    });
  }
  if (!owned) {
    throw new RBACError(`Carrier ${carrierId} is not in your client list — you can only access your own clients.`);
  }
}
