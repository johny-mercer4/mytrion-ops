/**
 * The security context threaded through every request, repo call, and tool handler.
 * Row-level isolation (tenant_id) and RBAC (role -> scopes, audience) are enforced
 * against this object — never against raw request input.
 */

/**
 * 'internal'  — Octane workers (Zoho widget / Mytrion app callers).
 * 'partner'   — external partner tenants (dormant scaffold).
 * 'customer'  — end customers (Telegram / mini-app). Deny-by-default everywhere: tools and
 *               agents must OPT IN via allowedAudiences, and customer contexts never honor
 *               client-supplied department scope (see routes/v1/callerIdentity.ts).
 */
export const AUDIENCES = ['internal', 'partner', 'customer'] as const;
export type Audience = (typeof AUDIENCES)[number];

export const ROLES = [
  'admin',
  /**
   * A signed-in Octane worker WITHOUT an admin-marker Zoho profile. Read scopes only — the
   * registry's write gate (riskClass !== 'read' requires role 'admin') is real for workers.
   * Derived from the verified Zoho profile at token mint/verify/refresh (workerRole.ts).
   */
  'worker',
  'ops',
  'finance',
  'support',
  'viewer',
  'driver',
  'fleet_manager',
] as const;
export type Role = (typeof ROLES)[number];

/**
 * Verified carrier-client access descriptor (from signed session claims). The RBAC ties:
 * 'owner' (fleet) → carrierId/applicationId — every card of the carrier;
 * 'driver' (child of an owner) → cardId — that one card only, with the card's limits.
 * Card-/carrier-scoped tools MUST read this to bound what a client session may see.
 */
export interface ClientAccess {
  profile: 'owner' | 'driver';
  carrierId?: string;
  applicationId?: string;
  /** Driver only: the single card this account is tied to. */
  cardId?: string;
  /** Driver only: the owner (fleet) account it belongs to. */
  parentUserId?: string;
}

export interface TenantContext {
  /** Always 'octane' for internal users; a partner tenant id for external users. */
  tenantId: string;
  userId: string;
  audience: Audience;
  role: Role;
  /** Derived from role; e.g. ['zoho_crm:read', 'octane_card:read']. '*' grants all. */
  scopes: string[];
  /**
   * Departments this request may access (RBAC for RAG + tools). Supplied per request by
   * the caller (trusted frontend/agent). Global/NULL-tagged knowledge is always visible;
   * department-tagged knowledge and department-restricted tools require a match here.
   */
  departments: string[];
  /** Manager/elevated access: bypass department filtering entirely ("almost everything"). */
  allDepartmentAccess: boolean;
  /**
   * Hard RBAC bypass (BYPASS_USERS). When true, the tool-access gate short-circuits to allow —
   * skipping audience / scope / write-risk / department checks. Reserved for a small, explicit
   * allowlist of user_names; never set from untrusted (customer) input.
   */
  bypassRbac?: boolean;
  /** Caller's external (e.g. Zoho) profile name(s). An "Administrator" profile grants allDepartmentAccess. */
  profiles?: string[];
  /** Caller's external (e.g. Zoho) role name — informational (audit / future per-role policy). */
  callerRole?: string;
  /** Caller's display name (e.g. Zoho user_name). Available to tool handlers for data scoping. */
  userName?: string;
  /**
   * Set by authority.narrowContext when a child agent is acting on the caller's behalf
   * (e.g. 'billing'). Flows into tool_calls/audit_log attribution — never grants access.
   */
  actingAgent?: string;
  /**
   * True when the identity fields (userId/userName/profiles/callerRole/allDepartmentAccess) came
   * from a VERIFIED session token (Zoho OAuth worker), not from client-supplied request body.
   * When set, buildCallerContext ignores body identity — only the department VIEW is taken from
   * the request. The static API_KEY (systemContext) leaves this unset.
   */
  sessionVerified?: boolean;
  /**
   * Set when an admin (allDepartmentAccess) is acting AS another agent via x-act-as-* headers:
   * the identity fields above ARE the impersonated agent, and this records the real admin's userId
   * for audit attribution. Only ever set from a verified admin session (see callerIdentity.ts).
   */
  impersonatorUserId?: string;
  /** Verified carrier-client access (customer-audience login sessions only). */
  client?: ClientAccess;
  requestId: string;
}

export function isAudience(value: unknown): value is Audience {
  return typeof value === 'string' && (AUDIENCES as readonly string[]).includes(value);
}

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}
