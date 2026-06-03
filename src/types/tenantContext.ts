/**
 * The security context threaded through every request, repo call, and tool handler.
 * Row-level isolation (tenant_id) and RBAC (role -> scopes, audience) are enforced
 * against this object — never against raw request input.
 */

export const AUDIENCES = ['internal', 'partner'] as const;
export type Audience = (typeof AUDIENCES)[number];

export const ROLES = [
  'admin',
  'ops',
  'finance',
  'support',
  'viewer',
  'driver',
  'fleet_manager',
] as const;
export type Role = (typeof ROLES)[number];

export interface TenantContext {
  /** Always 'octane' for internal users; a partner tenant id for external users. */
  tenantId: string;
  userId: string;
  audience: Audience;
  role: Role;
  /** Derived from role; e.g. ['zoho_crm:read', 'octane_card:read']. '*' grants all. */
  scopes: string[];
  requestId: string;
}

export function isAudience(value: unknown): value is Audience {
  return typeof value === 'string' && (AUDIENCES as readonly string[]).includes(value);
}

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}
