/**
 * Owner-scoping for servercrm agent-API tools. servercrm scopes data by the agent identity we
 * pass (agentName → carrier roster, or a zoho user id). We bind that to the CALLER:
 *  - Administrator (allDepartmentAccess): may target any agent (optional override), else self.
 *  - Everyone else: locked to their own identity (the Zoho context on the request).
 */
import { ToolError } from '../../lib/errors.js';
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
