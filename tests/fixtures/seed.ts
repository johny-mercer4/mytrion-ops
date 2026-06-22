import { scopesForRole } from '../../src/modules/auth/permissions.js';
import type { Audience, Role, TenantContext } from '../../src/types/tenantContext.js';

function audienceForRole(role: Role): Audience {
  return role === 'driver' || role === 'fleet_manager' ? 'partner' : 'internal';
}

/** Build a TenantContext for tests. Scopes default to the role's real scopes. */
export function makeContext(overrides: Partial<TenantContext> & { role?: Role } = {}): TenantContext {
  const role: Role = overrides.role ?? 'admin';
  const ctx: TenantContext = {
    tenantId: overrides.tenantId ?? 'tenant-A',
    userId: overrides.userId ?? 'user-1',
    audience: overrides.audience ?? audienceForRole(role),
    role,
    scopes: overrides.scopes ?? scopesForRole(role),
    departments: overrides.departments ?? [],
    allDepartmentAccess: overrides.allDepartmentAccess ?? role === 'admin',
    requestId: overrides.requestId ?? 'test-request',
  };
  if (overrides.userName !== undefined) ctx.userName = overrides.userName;
  if (overrides.profiles !== undefined) ctx.profiles = overrides.profiles;
  if (overrides.callerRole !== undefined) ctx.callerRole = overrides.callerRole;
  return ctx;
}

/** Minimal valid arguments for each tool, keyed by tool name. */
export const sampleToolArgs: Record<string, Record<string, unknown>> = {
  'knowledge.search': { query: 'fuel card policy' },
  'zoho_people.search_employees': {},
  'zoho_crm.query': { select_query: 'select id from Leads limit 0, 1' },
  'zoho_desk.search_tickets': {},
  'agent.sales_snapshot': {},
  'agent.debtors': {},
  'agent.activity': {},
};
