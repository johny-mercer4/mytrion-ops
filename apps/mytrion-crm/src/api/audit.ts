/** Audit trail (GET /v1/admin/audit) — who did what, when (workers AND carrier clients). */
import { request } from './transport';

export type AuditStatus = 'ok' | 'denied' | 'error';
export type AuditAudience = 'internal' | 'partner' | 'customer';

export interface AuditEntry {
  id: string;
  audience: AuditAudience | null;
  userId: string | null;
  userName: string | null;
  profile: string | null;
  callerRole: string | null;
  role: string | null;
  company: string | null;
  impersonatorUserId: string | null;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  toolName: string | null;
  status: AuditStatus;
  actingAgent: string | null;
  agentRunId: string | null;
  detail: Record<string, unknown> | null;
  requestId: string | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
}

export interface AuditFilter {
  /** Action PREFIX ('auth.' matches every auth event). */
  action?: string;
  /** EXACT action names — wins over `action` when both are set. Used by the Logins view. */
  actions?: string[];
  audience?: AuditAudience;
  status?: AuditStatus;
  userId?: string;
  /** Actor display name (agent name) — exact, from the facet dropdown. */
  userName?: string;
  profile?: string;
  role?: string;
  callerRole?: string;
  resourceType?: string;
  resourceId?: string;
  /** Free text across the identity + action columns, matched server-side across ALL rows. */
  search?: string;
  /** ISO instants. */
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

/** Option lists behind the filter dropdowns. */
export interface AuditFacets {
  userNames: string[];
  profiles: string[];
  roles: string[];
  callerRoles: string[];
  actions: string[];
  /** The exact action names that mean "someone signed in". */
  loginActions: string[];
}

function toQuery(filter: AuditFilter): Record<string, string | number | undefined> {
  return {
    action: filter.action,
    actions: filter.actions && filter.actions.length > 0 ? filter.actions.join(',') : undefined,
    audience: filter.audience,
    status: filter.status,
    user_id: filter.userId,
    user_name: filter.userName,
    profile: filter.profile,
    role: filter.role,
    caller_role: filter.callerRole,
    resource_type: filter.resourceType,
    resource_id: filter.resourceId,
    search: filter.search,
    from: filter.from,
    to: filter.to,
  };
}

export async function listAudit(
  filter: AuditFilter = {},
): Promise<{ entries: AuditEntry[]; total: number }> {
  return (await request('GET', '/admin/audit', {
    impersonate: false, // always inspect as the real admin, never as an acted-as agent
    query: {
      ...toQuery(filter),
      limit: filter.limit ?? 50,
      offset: filter.offset ?? 0,
    },
  })) as { entries: AuditEntry[]; total: number };
}

export async function auditFacets(): Promise<AuditFacets> {
  return (await request('GET', '/admin/audit/facets', {
    impersonate: false,
  })) as AuditFacets;
}

/** Hard ceiling the server also enforces — an export is one request, not a scrolled page. */
export const AUDIT_EXPORT_MAX = 10_000;

/**
 * Every row matching the CURRENT filter, for export — not just the pages already scrolled into
 * view. Given a longer timeout because it is one large query by design.
 */
export async function fetchAuditForExport(filter: AuditFilter = {}): Promise<AuditEntry[]> {
  const res = (await request('GET', '/admin/audit', {
    impersonate: false,
    timeoutMs: 120_000,
    query: { ...toQuery(filter), limit: AUDIT_EXPORT_MAX, offset: 0 },
  })) as { entries: AuditEntry[]; total: number };
  return res.entries;
}
