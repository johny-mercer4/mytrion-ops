import { env } from '../../config/env.js';
import type { NewAuditEntry } from '../../db/schema/index.js';
import { logger } from '../../lib/logger.js';
import { auditRepo } from '../../repos/auditRepo.js';
import type { TenantContext } from '../../types/tenantContext.js';

export type AuditStatus = 'ok' | 'denied' | 'error';

export interface AuditInput {
  tenantId: string;
  action: string;
  status: AuditStatus;
  audience?: TenantContext['audience'];
  userId?: string;
  /** Actor display name — worker user_name / carrier login. */
  userName?: string;
  /** External profile(s) — Zoho profile for workers, access profile for carrier users. */
  profile?: string;
  /** External (Zoho) role name. */
  callerRole?: string;
  /** Internal RBAC role the request ran with. */
  role?: string;
  /** Carrier/application tag(s) for customer-audience actors. */
  company?: string;
  /** Real admin's userId when running under act-as impersonation. */
  impersonatorUserId?: string;
  resourceType?: string;
  resourceId?: string;
  toolName?: string;
  /** Child agent acting on the caller's behalf (multi-agent attribution). */
  actingAgent?: string;
  agentRunId?: string;
  detail?: Record<string, unknown>;
  requestId?: string;
  ip?: string;
  userAgent?: string;
}

/**
 * Write an audit row. Best-effort: audit failures are logged but NEVER thrown, so a
 * broken audit pipeline can't take down a request. No-op when FF_AUDIT_LOG_ENABLED=0.
 */
export async function audit(input: AuditInput): Promise<void> {
  if (!env.FF_AUDIT_LOG_ENABLED) return;
  try {
    const entry: NewAuditEntry = {
      tenantId: input.tenantId,
      action: input.action,
      status: input.status,
    };
    if (input.audience !== undefined) entry.audience = input.audience;
    if (input.userId !== undefined) entry.userId = input.userId;
    if (input.userName !== undefined) entry.userName = input.userName;
    if (input.profile !== undefined) entry.profile = input.profile;
    if (input.callerRole !== undefined) entry.callerRole = input.callerRole;
    if (input.role !== undefined) entry.role = input.role;
    if (input.company !== undefined) entry.company = input.company;
    if (input.impersonatorUserId !== undefined) {
      entry.impersonatorUserId = input.impersonatorUserId;
    }
    if (input.resourceType !== undefined) entry.resourceType = input.resourceType;
    if (input.resourceId !== undefined) entry.resourceId = input.resourceId;
    if (input.toolName !== undefined) entry.toolName = input.toolName;
    if (input.actingAgent !== undefined) entry.actingAgent = input.actingAgent;
    if (input.agentRunId !== undefined) entry.agentRunId = input.agentRunId;
    if (input.detail !== undefined) entry.detail = input.detail;
    if (input.requestId !== undefined) entry.requestId = input.requestId;
    if (input.ip !== undefined) entry.ip = input.ip;
    if (input.userAgent !== undefined) entry.userAgent = input.userAgent;
    await auditRepo.insert(entry);
  } catch (err) {
    logger.error({ err, action: input.action }, 'failed to write audit log');
  }
}

/**
 * Convenience that stamps the FULL actor identity from the security context onto the row —
 * who (userName/userId), with what authority (profile, Zoho role, internal role), for which
 * company (customer-audience carrier/application tags), plus request + multi-agent
 * attribution. Works identically for internal workers and carrier-client sessions, so
 * "which user / which company pressed what, when" is answerable from the columns alone.
 */
export async function auditFromContext(
  ctx: TenantContext,
  fields: {
    action: string;
    status: AuditStatus;
    resourceType?: string;
    resourceId?: string;
    toolName?: string;
    agentRunId?: string;
    detail?: Record<string, unknown>;
  },
): Promise<void> {
  // Customer-audience contexts carry their company id(s) as department tags.
  const company = ctx.audience === 'customer' ? ctx.departments.join(', ') : undefined;
  await audit({
    tenantId: ctx.tenantId,
    audience: ctx.audience,
    userId: ctx.userId,
    role: ctx.role,
    requestId: ctx.requestId,
    ...(ctx.userName !== undefined ? { userName: ctx.userName } : {}),
    ...(ctx.profiles && ctx.profiles.length > 0 ? { profile: ctx.profiles.join(', ') } : {}),
    ...(ctx.callerRole !== undefined ? { callerRole: ctx.callerRole } : {}),
    ...(company ? { company } : {}),
    // When impersonating (admin "act as agent"), the row is attributed to the impersonated
    // identity; the real admin lands in its own column so the action traces to a person.
    ...(ctx.impersonatorUserId !== undefined
      ? { impersonatorUserId: ctx.impersonatorUserId }
      : {}),
    ...(ctx.actingAgent !== undefined ? { actingAgent: ctx.actingAgent } : {}),
    ...fields,
  });
}
