import { and, count, desc, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  mytrionCalls,
  type MytrionCall,
  type MytrionCallSourceType,
  type NewMytrionCall,
} from '../db/schema/index.js';
import type { TenantContext } from '../types/tenantContext.js';
import { firstOrThrow, firstOrUndefined, isUniqueViolation, normalizePagination } from './util.js';

/** The caller-supplied fields for one logged call; tenant + defaults are set by the repo. */
export interface CreateCallInput {
  callerZohoUserId: string;
  phoneNumber?: string | null;
  callTime?: Date;
  durationSeconds?: number;
  callStatus: MytrionCall['callStatus'];
  sourceType?: MytrionCallSourceType | null;
  sourceId?: string | null;
  sessionId?: string | null;
  direction?: string | null;
  result?: string | null;
}

/**
 * mytrion_calls — our own call log. Every read/write is tenant-scoped (ctx.tenantId); there are no
 * DB FKs, so isolation lives here. Insertion is best-effort at the call site (a logging blip must
 * never fail the call-event request), so `create` just does the tenant-bound insert.
 */
export const mytrionCallRepo = {
  async create(ctx: TenantContext, input: CreateCallInput): Promise<MytrionCall> {
    if (input.sessionId) {
      const existing = await this.findBySessionId(ctx, input.sessionId);
      if (existing) return existing;
    }
    const row: NewMytrionCall = {
      tenantId: ctx.tenantId,
      callerZohoUserId: input.callerZohoUserId,
      phoneNumber: input.phoneNumber ?? null,
      ...(input.callTime ? { callTime: input.callTime } : {}),
      durationSeconds: input.durationSeconds ?? 0,
      callStatus: input.callStatus,
      sourceType: input.sourceType ?? null,
      sourceId: input.sourceId ?? null,
      sessionId: input.sessionId ?? null,
      direction: input.direction ?? null,
      result: input.result ?? null,
    };
    try {
      const rows = await db.insert(mytrionCalls).values(row).returning();
      return firstOrThrow(rows, 'mytrion_calls insert returned no row');
    } catch (error) {
      if (input.sessionId && isUniqueViolation(error)) {
        const winner = await this.findBySessionId(ctx, input.sessionId);
        if (winner) return winner;
      }
      throw error;
    }
  },

  async findBySessionId(
    ctx: TenantContext,
    sessionId: string,
  ): Promise<MytrionCall | undefined> {
    const rows = await db
      .select()
      .from(mytrionCalls)
      .where(
        and(
          eq(mytrionCalls.tenantId, ctx.tenantId),
          eq(mytrionCalls.sessionId, sessionId),
        ),
      )
      .limit(1);
    return firstOrUndefined(rows);
  },

  /** Count a source record's logged calls (tenant-scoped) — drives the Lead call-number auto-advance. */
  async countForSource(
    ctx: TenantContext,
    sourceType: MytrionCallSourceType,
    sourceId: string,
  ): Promise<number> {
    const rows = await db
      .select({ n: count() })
      .from(mytrionCalls)
      .where(
        and(
          eq(mytrionCalls.tenantId, ctx.tenantId),
          eq(mytrionCalls.sourceType, sourceType),
          eq(mytrionCalls.sourceId, sourceId),
        ),
      );
    return Number(rows[0]?.n ?? 0);
  },

  /** A source record's call history (tenant-scoped), newest first — for future call-log views. */
  async listForSource(
    ctx: TenantContext,
    sourceType: MytrionCallSourceType,
    sourceId: string,
    opts?: { limit?: number; offset?: number },
  ): Promise<MytrionCall[]> {
    const { limit, offset } = normalizePagination(opts);
    return db
      .select()
      .from(mytrionCalls)
      .where(
        and(
          eq(mytrionCalls.tenantId, ctx.tenantId),
          eq(mytrionCalls.sourceType, sourceType),
          eq(mytrionCalls.sourceId, sourceId),
        ),
      )
      .orderBy(desc(mytrionCalls.createdAt))
      .limit(limit)
      .offset(offset);
  },
};
