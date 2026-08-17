import { and, asc, desc, eq, gte, ilike, inArray, isNotNull, lte, or, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { db } from '../db/client.js';
import { auditLog, type AuditEntry, type NewAuditEntry } from '../db/schema/index.js';
import type { Audience, TenantContext } from '../types/tenantContext.js';
import { ciTestActorSql } from '../modules/audit/auditActorDisplay.js';
import { normalizePagination } from './util.js';

/** Row ceiling for a filtered export. Above this the answer is a report, not a spreadsheet. */
export const AUDIT_EXPORT_MAX = 10_000;

export interface AuditFilter {
  /** Action PREFIX match ('auth.' → every auth event; exact names work too). */
  action?: string;
  /**
   * EXACT action list, OR-ed. The Logins view needs this: its three events (`auth.login`,
   * `auth.zoho.login`, `mini_app.auth.login`) share no prefix, and the `auth.` prefix that used to
   * stand in for it also swept up `auth.act_as` — 9k rows of per-request impersonation noise
   * against ~100 real logins.
   */
  actions?: string[];
  audience?: Audience;
  status?: 'ok' | 'denied' | 'error';
  userId?: string;
  /** Actor display name — exact match, fed by the facet dropdown. */
  userName?: string;
  profile?: string;
  /** Internal RBAC role ('admin' | 'worker' | …). */
  role?: string;
  /** External (Zoho) role name. */
  callerRole?: string;
  resourceType?: string;
  resourceId?: string;
  /** Free text across the identity + action columns (case-insensitive contains). */
  search?: string;
  from?: Date;
  to?: Date;
  /**
   * `human` (default) hides Vitest fixture actors (`zoho:42`, `zoho:888`, …).
   * `vitest` is only those rows — the Admin "Vitest Logs" tab.
   */
  source?: 'human' | 'vitest';
  limit?: number;
  offset?: number;
}

function whereFor(ctx: TenantContext, filter?: AuditFilter): SQL | undefined {
  const clauses: SQL[] = [eq(auditLog.tenantId, ctx.tenantId)];
  // Prefix match stays LIKE-with-trailing-% so 'auth.' keeps meaning "every auth event".
  if (filter?.action) clauses.push(ilike(auditLog.action, `${filter.action}%`));
  if (filter?.actions && filter.actions.length > 0) {
    clauses.push(inArray(auditLog.action, filter.actions));
  }
  if (filter?.audience) clauses.push(eq(auditLog.audience, filter.audience));
  if (filter?.status) clauses.push(eq(auditLog.status, filter.status));
  if (filter?.userId) clauses.push(eq(auditLog.userId, filter.userId));
  if (filter?.userName) clauses.push(eq(auditLog.userName, filter.userName));
  if (filter?.profile) clauses.push(eq(auditLog.profile, filter.profile));
  if (filter?.role) clauses.push(eq(auditLog.role, filter.role));
  if (filter?.callerRole) clauses.push(eq(auditLog.callerRole, filter.callerRole));
  if (filter?.resourceType) clauses.push(eq(auditLog.resourceType, filter.resourceType));
  if (filter?.resourceId) clauses.push(eq(auditLog.resourceId, filter.resourceId));
  if (filter?.from) clauses.push(gte(auditLog.createdAt, filter.from));
  if (filter?.to) clauses.push(lte(auditLog.createdAt, filter.to));
  clauses.push(ciTestActorSql(filter?.source === 'vitest'));
  if (filter?.search) {
    // Escape the LIKE wildcards so a carrier id containing '%' or '_' is searched literally.
    const term = `%${filter.search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const any = or(
      ilike(auditLog.userName, term),
      ilike(auditLog.userId, term),
      ilike(auditLog.company, term),
      ilike(auditLog.action, term),
      ilike(auditLog.profile, term),
      ilike(auditLog.callerRole, term),
      ilike(auditLog.resourceId, term),
      ilike(auditLog.toolName, term),
    );
    if (any) clauses.push(any);
  }
  return and(...clauses);
}

/** One DISTINCT column, non-null, alphabetical — the option list behind a filter dropdown. */
async function distinct(
  ctx: TenantContext,
  column: AnyPgColumn,
  extra?: SQL,
  cap = 500,
): Promise<string[]> {
  const rows = await db
    .selectDistinct({ value: column })
    .from(auditLog)
    .where(and(eq(auditLog.tenantId, ctx.tenantId), isNotNull(column), extra))
    .orderBy(asc(column))
    .limit(cap);
  // `AnyPgColumn` erases the column's data type, so Drizzle infers `value: never` for the generic
  // select. Every column this is called with is `text`, so read it back as the string it is.
  const values = rows as unknown as Array<{ value: string | null }>;
  return values.map((r) => r.value).filter((v): v is string => typeof v === 'string' && v !== '');
}

export interface AuditFacets {
  userNames: string[];
  profiles: string[];
  roles: string[];
  callerRoles: string[];
  actions: string[];
}

export const auditRepo = {
  /** Append a row. Callers (auditLogger) decide whether to swallow failures. */
  async insert(entry: NewAuditEntry): Promise<void> {
    await db.insert(auditLog).values(entry);
  },

  async list(ctx: TenantContext, filter?: AuditFilter): Promise<AuditEntry[]> {
    const { limit, offset } = normalizePagination(filter, AUDIT_EXPORT_MAX);
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

  /** Option lists for the Audit Log filter dropdowns (agent name, profile, role). */
  async facets(ctx: TenantContext, filter?: Pick<AuditFilter, 'source'>): Promise<AuditFacets> {
    const source = ciTestActorSql(filter?.source === 'vitest');
    const [userNames, profiles, roles, callerRoles, actions] = await Promise.all([
      distinct(ctx, auditLog.userName, source),
      distinct(ctx, auditLog.profile, source),
      distinct(ctx, auditLog.role, source),
      distinct(ctx, auditLog.callerRole, source),
      distinct(ctx, auditLog.action, source),
    ]);
    return { userNames, profiles, roles, callerRoles, actions };
  },

  /**
   * How many rows match in a recent window — the throttle probe behind the "one row per session"
   * login/impersonation/Mytrion-entry rules. Cheap: bounded by `from` and served by
   * audit_log_action_created_idx.
   */
  async existsSince(
    ctx: TenantContext,
    params: { action: string; userId?: string; resourceId?: string; since: Date },
  ): Promise<boolean> {
    const clauses: SQL[] = [
      eq(auditLog.tenantId, ctx.tenantId),
      eq(auditLog.action, params.action),
      gte(auditLog.createdAt, params.since),
    ];
    if (params.userId) clauses.push(eq(auditLog.userId, params.userId));
    if (params.resourceId) clauses.push(eq(auditLog.resourceId, params.resourceId));
    const rows = await db
      .select({ one: sql<number>`1` })
      .from(auditLog)
      .where(and(...clauses))
      .limit(1);
    return rows.length > 0;
  },
};
