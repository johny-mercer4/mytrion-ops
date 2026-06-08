import { scopesForRole } from '../../src/modules/auth/permissions.js';
import type { Audience, Role, TenantContext } from '../../src/types/tenantContext.js';

function audienceForRole(role: Role): Audience {
  return role === 'driver' || role === 'fleet_manager' ? 'partner' : 'internal';
}

/** Build a TenantContext for tests. Scopes default to the role's real scopes. */
export function makeContext(overrides: Partial<TenantContext> & { role?: Role } = {}): TenantContext {
  const role: Role = overrides.role ?? 'admin';
  return {
    tenantId: overrides.tenantId ?? 'tenant-A',
    userId: overrides.userId ?? 'user-1',
    audience: overrides.audience ?? audienceForRole(role),
    role,
    scopes: overrides.scopes ?? scopesForRole(role),
    departments: overrides.departments ?? [],
    allDepartmentAccess: overrides.allDepartmentAccess ?? role === 'admin',
    requestId: overrides.requestId ?? 'test-request',
  };
}

/** Minimal valid arguments for each tool, keyed by tool name. */
export const sampleToolArgs: Record<string, Record<string, unknown>> = {
  'knowledge.search': { query: 'fuel card policy' },
  'zoho_crm.search_accounts': { query: 'acme' },
  'zoho_crm.get_account': { accountId: 'acc_1' },
  'octane.customer_lookup': { identifier: 'customer-1' },
  'octane.card_status': { cardId: 'card_1' },
  'octane.transaction_search': { cardId: 'card_1' },
  'partner.driver_lookup': { driverId: 'driver_1' },
  'partner.fleet_summary': {},
};
