/**
 * Owner-scoping for servercrm agent-API tools. servercrm scopes data by the agent identity we
 * pass (agentName → carrier roster, or a zoho user id). We bind that to the CALLER:
 *  - Administrator (allDepartmentAccess): may target any agent (optional override), else self.
 *  - Everyone else: locked to their own identity (the Zoho context on the request).
 */
import { RBACError, ToolError } from '../../lib/errors.js';
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

/**
 * Enforce owner-scoping on a carrier-keyed action: a non-admin caller may only touch carriers in
 * their own roster. servercrm does NOT check this — it's OUR responsibility. Admins / bypass skip.
 * Verified with a targeted by-agent lookup (carrierId filter), so it's precise and cheap.
 */
export async function assertCarrierOwned(ctx: TenantContext, carrierId: number | string): Promise<void> {
  if (ctx.allDepartmentAccess || ctx.bypassRbac) return;
  const zohoUserId = resolveZohoUserId(ctx);
  const res = await serverCrmGet<ByAgentResponse>(
    `/api/clients/by-agent/${encodeURIComponent(zohoUserId)}`,
    { carrierId: String(carrierId), limit: 1 },
  );
  const owned = (res.data ?? []).some((c) => String(c.carrier_id) === String(carrierId));
  if (!owned) {
    throw new RBACError(`Carrier ${carrierId} is not in your client list — you can only access your own clients.`);
  }
}
