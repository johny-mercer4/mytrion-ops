import { createId } from '@paralleldrive/cuid2';
import {
  and, asc, desc, eq, gte, ilike, isNotNull, lte, ne, notLike, or, sql, type SQL,
} from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { db } from '../db/client.js';
import {
  automationLogs,
  type AutomationPhase,
  DEFAULT_AUTOMATION_ORIGIN,
  type AutomationLog,
  type AutomationOriginSource,
  type NewAutomationLog,
} from '../db/schema/index.js';
import { AppError } from '../lib/errors.js';
import type { TenantContext } from '../types/tenantContext.js';
import { normalizePagination } from './util.js';

/** Row ceiling for a filtered export — same contract as the audit log. */
export const AUTOMATION_EXPORT_MAX = 10_000;

export interface NewAutomationLogInput {
  automationType: string;
  runId?: string | undefined;
  phase?: AutomationPhase | undefined;
  durationMs?: number | undefined;
  errorCode?: string | undefined;
  actorUserId: string;
  impersonatorUserId?: string | undefined;
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
  phase?: AutomationPhase;
  /** Free text across type + agent (case-insensitive contains). */
  search?: string;
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
}

/**
 * Scheduled department jobs are not Sales-tab automations.
 *
 * They stopped writing here (see jobs/workers/automations.ts), but the 38 rows they already wrote
 * cannot be taken back out of an append-only table. Their dot-namespaced
 * `automation.<dept>.<job>` types match no catalog block, so the admin tab excludes them instead
 * of offering a filter value for an automation nobody can submit.
 */
const submittedFromTheSalesTab = notLike(automationLogs.automationType, 'automation.%');

function whereFor(ctx: TenantContext, filter?: AutomationLogFilter): SQL | undefined {
  const clauses: SQL[] = [eq(automationLogs.tenantId, ctx.tenantId), submittedFromTheSalesTab];
  if (filter?.automationType) clauses.push(eq(automationLogs.automationType, filter.automationType));
  if (filter?.agentName) clauses.push(eq(automationLogs.agentName, filter.agentName));
  if (filter?.originSource) clauses.push(eq(automationLogs.originSource, filter.originSource));
  // One submit is one row now, but the 24 `started` rows written on 2026-08-20 are still in the
  // table and would double-count those runs. An explicit phase still reaches them.
  clauses.push(
    filter?.phase
      ? eq(automationLogs.phase, filter.phase)
      : ne(automationLogs.phase, 'started'),
  );
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
    .where(and(
      eq(automationLogs.tenantId, ctx.tenantId),
      submittedFromTheSalesTab,
      isNotNull(column),
    ))
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

function runConflict(message: string): AppError {
  return new AppError(message, {
    statusCode: 409,
    code: 'AUTOMATION_RUN_CONFLICT',
    expose: true,
  });
}

function assertSameRunIdentity(
  rows: AutomationLog[],
  input: NewAutomationLogInput,
  originSource: AutomationOriginSource,
): void {
  const impersonatorUserId = input.impersonatorUserId ?? null;
  for (const row of rows) {
    if (
      row.actorUserId !== input.actorUserId ||
      row.impersonatorUserId !== impersonatorUserId ||
      row.automationType !== input.automationType ||
      row.originSource !== originSource
    ) {
      throw runConflict('Automation run identity does not match its earlier lifecycle phase');
    }
  }
}

export const automationLogRepo = {
  /** Insert one run outcome. A retry of the same tenant/run/phase returns the winner. */
  async insert(
    ctx: TenantContext,
    input: NewAutomationLogInput,
  ): Promise<{ log: AutomationLog; inserted: boolean }> {
    const id = createId();
    const runId = input.runId ?? id;
    const phase = input.phase ?? 'succeeded';
    const originSource = input.originSource ?? DEFAULT_AUTOMATION_ORIGIN;
    const values: NewAutomationLog = {
      id,
      tenantId: ctx.tenantId,
      runId,
      phase,
      sourceMytrion: 'sales',
      actorUserId: input.actorUserId,
      automationType: input.automationType,
      originSource,
    };
    if (input.durationMs !== undefined) values.durationMs = input.durationMs;
    if (input.errorCode !== undefined) values.errorCode = input.errorCode;
    if (input.impersonatorUserId !== undefined) {
      values.impersonatorUserId = input.impersonatorUserId;
    }
    if (input.agentName !== undefined) values.agentName = input.agentName;
    if (input.triggerTime !== undefined) values.triggerTime = input.triggerTime;
    if (input.triggerDate !== undefined) values.triggerDate = input.triggerDate;
    return db.transaction(async (tx) => {
      // Lifecycle phases may arrive concurrently. Serialize one logical run so identity checks and
      // the single-terminal invariant cannot race across requests or app instances.
      await tx.execute(sql`
        select pg_advisory_xact_lock(
          hashtextextended(${`${ctx.tenantId}:${runId}`}, 0)
        )
      `);
      const existingRun = await tx
        .select()
        .from(automationLogs)
        .where(
          and(
            eq(automationLogs.tenantId, ctx.tenantId),
            eq(automationLogs.runId, runId),
          ),
        );
      assertSameRunIdentity(existingRun, input, originSource);
      const replay = existingRun.find((row) => row.phase === phase);
      if (replay) return { log: replay, inserted: false };
      if (
        phase !== 'started' &&
        existingRun.some((row) => row.phase === 'succeeded' || row.phase === 'failed')
      ) {
        throw runConflict('Automation run already has a terminal outcome');
      }
      const rows = await tx
        .insert(automationLogs)
        .values(values)
        .onConflictDoNothing()
        .returning();
      if (rows[0]) return { log: rows[0], inserted: true };
      const concurrentRun = await tx
        .select()
        .from(automationLogs)
        .where(
          and(
            eq(automationLogs.tenantId, ctx.tenantId),
            eq(automationLogs.runId, runId),
          ),
        );
      assertSameRunIdentity(concurrentRun, input, originSource);
      const winner = concurrentRun.find((row) => row.phase === phase);
      if (winner) return { log: winner, inserted: false };
      throw runConflict('Automation run already has a conflicting lifecycle phase');
    });
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
