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
  audience?: AuditAudience;
  status?: AuditStatus;
  userId?: string;
  limit?: number;
  offset?: number;
}

export async function listAudit(
  filter: AuditFilter = {},
): Promise<{ entries: AuditEntry[]; total: number }> {
  return (await request('GET', '/admin/audit', {
    impersonate: false, // always inspect as the real admin, never as an acted-as agent
    query: {
      action: filter.action,
      audience: filter.audience,
      status: filter.status,
      user_id: filter.userId,
      limit: filter.limit ?? 50,
      offset: filter.offset ?? 0,
    },
  })) as { entries: AuditEntry[]; total: number };
}
