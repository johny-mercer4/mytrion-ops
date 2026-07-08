import { and, desc, eq, like, sql, type SQL } from 'drizzle-orm';
import { db } from '../db/client.js';
import { auditLog, type AuditEntry, type NewAuditEntry } from '../db/schema/index.js';
import type { Audience, TenantContext } from '../types/tenantContext.js';
import { normalizePagination } from './util.js';

export interface AuditFilter {
  /** Action PREFIX match ('auth.' → every auth event; exact names work too). */
  action?: string;
  audience?: Audience;
  status?: 'ok' | 'denied' | 'error';
  userId?: string;
  limit?: number;
  offset?: number;
}

function whereFor(ctx: TenantContext, filter?: AuditFilter): SQL | undefined {
  const clauses: SQL[] = [eq(auditLog.tenantId, ctx.tenantId)];
  if (filter?.action) clauses.push(like(auditLog.action, `${filter.action}%`));
  if (filter?.audience) clauses.push(eq(auditLog.audience, filter.audience));
  if (filter?.status) clauses.push(eq(auditLog.status, filter.status));
  if (filter?.userId) clauses.push(eq(auditLog.userId, filter.userId));
  return and(...clauses);
}

export const auditRepo = {
  /** Append a row. Callers (auditLogger) decide whether to swallow failures. */
  async insert(entry: NewAuditEntry): Promise<void> {
    await db.insert(auditLog).values(entry);
  },

  async list(ctx: TenantContext, filter?: AuditFilter): Promise<AuditEntry[]> {
    const { limit, offset } = normalizePagination(filter);
    return db
      .select()
      .from(auditLog)
      .where(whereFor(ctx, filter))
      .orderBy(desc(auditLog.createdAt))
      .limit(limit)
      .offset(offset);
  },

  async count(ctx: TenantContext, filter?: AuditFilter): Promise<number> {
    const rows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(auditLog)
      .where(whereFor(ctx, filter));
    return rows[0]?.count ?? 0;
  },
};
