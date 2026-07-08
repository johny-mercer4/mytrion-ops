import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { agentTasks, type AgentTask, type NewAgentTask } from '../db/schema/index.js';
import type { TenantContext } from '../types/tenantContext.js';

/**
 * User-visible background tasks. Every query is tenant-scoped; list defaults to the
 * requester's own tasks (owner isolation like conversations). Status transitions guard
 * against pg-boss job re-delivery: a completed/cancelled task is never re-run.
 */
export const agentTaskRepo = {
  async create(ctx: TenantContext, input: Omit<NewAgentTask, 'tenantId'>): Promise<AgentTask> {
    const [row] = await db
      .insert(agentTasks)
      .values({ ...input, tenantId: ctx.tenantId })
      .returning();
    if (!row) throw new Error('insert into agent_tasks returned no row');
    return row;
  },

  async setJobId(ctx: TenantContext, id: string, jobId: string): Promise<void> {
    await db
      .update(agentTasks)
      .set({ jobId, updatedAt: sql`now()` })
      .where(and(eq(agentTasks.tenantId, ctx.tenantId), eq(agentTasks.id, id)));
  },

  async findById(ctx: TenantContext, id: string): Promise<AgentTask | undefined> {
    const rows = await db
      .select()
      .from(agentTasks)
      .where(and(eq(agentTasks.tenantId, ctx.tenantId), eq(agentTasks.id, id)))
      .limit(1);
    return rows[0];
  },

  /** The requester's tasks, newest first. Admin (allDepartmentAccess) may list all. */
  async listForRequester(ctx: TenantContext, limit = 30): Promise<AgentTask[]> {
    const conditions = [eq(agentTasks.tenantId, ctx.tenantId)];
    if (!ctx.allDepartmentAccess) conditions.push(eq(agentTasks.userId, ctx.userId));
    return db
      .select()
      .from(agentTasks)
      .where(and(...conditions))
      .orderBy(desc(agentTasks.createdAt))
      .limit(limit);
  },

  /**
   * Claim the task for execution. Transitions only from queued/running/failed (re-delivery of
   * a completed or cancelled task must NOT re-run) — returns the claimed row or undefined.
   */
  async markRunning(ctx: TenantContext, id: string): Promise<AgentTask | undefined> {
    const rows = await db
      .update(agentTasks)
      .set({ status: 'running', startedAt: sql`coalesce(started_at, now())`, updatedAt: sql`now()` })
      .where(
        and(
          eq(agentTasks.tenantId, ctx.tenantId),
          eq(agentTasks.id, id),
          inArray(agentTasks.status, ['queued', 'running', 'failed']),
        ),
      )
      .returning();
    return rows[0];
  },

  async updateProgress(ctx: TenantContext, id: string, progress: Record<string, unknown>): Promise<void> {
    await db
      .update(agentTasks)
      .set({ progress, updatedAt: sql`now()` })
      .where(and(eq(agentTasks.tenantId, ctx.tenantId), eq(agentTasks.id, id)));
  },

  async complete(ctx: TenantContext, id: string, result: Record<string, unknown>): Promise<void> {
    await db
      .update(agentTasks)
      .set({ status: 'completed', result, error: null, finishedAt: sql`now()`, updatedAt: sql`now()` })
      .where(and(eq(agentTasks.tenantId, ctx.tenantId), eq(agentTasks.id, id)));
  },

  async fail(ctx: TenantContext, id: string, error: string): Promise<void> {
    await db
      .update(agentTasks)
      .set({ status: 'failed', error, finishedAt: sql`now()`, updatedAt: sql`now()` })
      .where(and(eq(agentTasks.tenantId, ctx.tenantId), eq(agentTasks.id, id)));
  },

  /** Cancel a queued/running task (owner or admin). Returns the row when the transition applied. */
  async cancel(ctx: TenantContext, id: string): Promise<AgentTask | undefined> {
    const conditions = [
      eq(agentTasks.tenantId, ctx.tenantId),
      eq(agentTasks.id, id),
      inArray(agentTasks.status, ['queued', 'running']),
    ];
    if (!ctx.allDepartmentAccess) conditions.push(eq(agentTasks.userId, ctx.userId));
    const rows = await db
      .update(agentTasks)
      .set({ status: 'cancelled', finishedAt: sql`now()`, updatedAt: sql`now()` })
      .where(and(...conditions))
      .returning();
    return rows[0];
  },
};
