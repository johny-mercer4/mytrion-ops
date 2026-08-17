import { and, asc, desc, eq, gte, ilike, isNotNull, lte, or, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { db } from '../db/client.js';
import {
  automationLogs,
  DEFAULT_AUTOMATION_ORIGIN,
  type AutomationLog,
  type AutomationOriginSource,
  type NewAutomationLog,
} from '../db/schema/index.js';
import type { TenantContext } from '../types/tenantContext.js';
import { firstOrThrow, normalizePagination } from './util.js';

/** Row ceiling for a filtered export — same contract as the audit log. */
export const AUTOMATION_EXPORT_MAX = 10_000;

export interface NewAutomationLogInput {
  automationType: string;
  agentName?: string | undefined;
  triggerTime?: string | undefined;
  triggerDate?: string | undefined;
  /** Which surface fired it. Omitted ⇒ 'Mytrion Zoho' (the honest fallback). */
  originSource?: AutomationOriginSource | undefined;
}

export interface AutomationLogFilter {
  automationType?: string;
  agentName?: string;
  originSource?: AutomationOriginSource;
  /** Free text across type + agent (case-insensitive contains). */
  search?: string;
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
}

function whereFor(ctx: TenantContext, filter?: AutomationLogFilter): SQL | undefined {
  const clauses: SQL[] = [eq(automationLogs.tenantId, ctx.tenantId)];
  if (filter?.automationType) clauses.push(eq(automationLogs.automationType, filter.automationType));
  if (filter?.agentName) clauses.push(eq(automationLogs.agentName, filter.agentName));
  if (filter?.originSource) clauses.push(eq(automationLogs.originSource, filter.originSource));
  if (filter?.from) clauses.push(gte(automationLogs.createdAt, filter.from));
  if (filter?.to) clauses.push(lte(automationLogs.createdAt, filter.to));
  if (filter?.search) {
    const term = `%${filter.search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const any = or(
      ilike(automationLogs.automationType, term),
      ilike(automationLogs.agentName, term),
    );
    if (any) clauses.push(any);
  }
  return and(...clauses);
}

async function distinct(ctx: TenantContext, column: AnyPgColumn, cap = 500): Promise<string[]> {
  const rows = await db
    .selectDistinct({ value: column })
    .from(automationLogs)
    .where(and(eq(automationLogs.tenantId, ctx.tenantId), isNotNull(column)))
    .orderBy(asc(column))
    .limit(cap);
  // `AnyPgColumn` erases the column's data type, so Drizzle infers `value: never` for the generic
  // select. Every column this is called with is `text`, so read it back as the string it is.
  const values = rows as unknown as Array<{ value: string | null }>;
  return values.map((r) => r.value).filter((v): v is string => typeof v === 'string' && v !== '');
}

export interface AutomationLogFacets {
  automationTypes: string[];
  agentNames: string[];
  originSources: string[];
}

export const automationLogRepo = {
  /** Insert one automation log row (tenant from ctx). Returns the created row. */
  async insert(ctx: TenantContext, input: NewAutomationLogInput): Promise<AutomationLog> {
    const values: NewAutomationLog = {
      tenantId: ctx.tenantId,
      automationType: input.automationType,
      originSource: input.originSource ?? DEFAULT_AUTOMATION_ORIGIN,
    };
    if (input.agentName !== undefined) values.agentName = input.agentName;
    if (input.triggerTime !== undefined) values.triggerTime = input.triggerTime;
    if (input.triggerDate !== undefined) values.triggerDate = input.triggerDate;
    const rows = await db.insert(automationLogs).values(values).returning();
    return firstOrThrow(rows, 'Failed to insert automation log');
  },

  async list(ctx: TenantContext, filter?: AutomationLogFilter): Promise<AutomationLog[]> {
    const { limit, offset } = normalizePagination(filter, AUTOMATION_EXPORT_MAX);
    return db
      .select()
      .from(automationLogs)
      .where(whereFor(ctx, filter))
      .orderBy(desc(automationLogs.createdAt))
      .limit(limit)
      .offset(offset);
  },

  async count(ctx: TenantContext, filter?: AutomationLogFilter): Promise<number> {
    const rows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(automationLogs)
      .where(whereFor(ctx, filter));
    return rows[0]?.count ?? 0;
  },

  /** Option lists for the Automation Logs filter dropdowns. */
  async facets(ctx: TenantContext): Promise<AutomationLogFacets> {
    const [automationTypes, agentNames, originSources] = await Promise.all([
      distinct(ctx, automationLogs.automationType),
      distinct(ctx, automationLogs.agentName),
      distinct(ctx, automationLogs.originSource),
    ]);
    return { automationTypes, agentNames, originSources };
  },
};
