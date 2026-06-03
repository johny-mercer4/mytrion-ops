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
  resourceType?: string;
  resourceId?: string;
  toolName?: string;
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
    if (input.resourceType !== undefined) entry.resourceType = input.resourceType;
    if (input.resourceId !== undefined) entry.resourceId = input.resourceId;
    if (input.toolName !== undefined) entry.toolName = input.toolName;
    if (input.detail !== undefined) entry.detail = input.detail;
    if (input.requestId !== undefined) entry.requestId = input.requestId;
    if (input.ip !== undefined) entry.ip = input.ip;
    if (input.userAgent !== undefined) entry.userAgent = input.userAgent;
    await auditRepo.insert(entry);
  } catch (err) {
    logger.error({ err, action: input.action }, 'failed to write audit log');
  }
}

/** Convenience that fills tenant/audience/user/request from the security context. */
export async function auditFromContext(
  ctx: TenantContext,
  fields: {
    action: string;
    status: AuditStatus;
    resourceType?: string;
    resourceId?: string;
    toolName?: string;
    detail?: Record<string, unknown>;
  },
): Promise<void> {
  await audit({
    tenantId: ctx.tenantId,
    audience: ctx.audience,
    userId: ctx.userId,
    requestId: ctx.requestId,
    ...fields,
  });
}
