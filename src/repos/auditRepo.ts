import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { auditLog, type AuditEntry, type NewAuditEntry } from '../db/schema/index.js';
import type { TenantContext } from '../types/tenantContext.js';
import { normalizePagination } from './util.js';

export const auditRepo = {
  /** Append a row. Callers (auditLogger) decide whether to swallow failures. */
  async insert(entry: NewAuditEntry): Promise<void> {
    await db.insert(auditLog).values(entry);
  },

  async list(
    ctx: TenantContext,
    filter?: { action?: string; limit?: number; offset?: number },
  ): Promise<AuditEntry[]> {
    const { limit, offset } = normalizePagination(filter);
    const where = filter?.action
      ? and(eq(auditLog.tenantId, ctx.tenantId), eq(auditLog.action, filter.action))
      : eq(auditLog.tenantId, ctx.tenantId);
    return db
      .select()
      .from(auditLog)
      .where(where)
      .orderBy(desc(auditLog.createdAt))
      .limit(limit)
      .offset(offset);
  },
};
