import { and, desc, eq, lt, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { approvals, type Approval, type NewApproval } from '../db/schema/index.js';
import type { TenantContext } from '../types/tenantContext.js';

export const approvalRepo = {
  async create(ctx: TenantContext, input: Omit<NewApproval, 'tenantId'>): Promise<Approval> {
    const [row] = await db
      .insert(approvals)
      .values({ ...input, tenantId: ctx.tenantId })
      .returning();
    if (!row) throw new Error('insert into approvals returned no row');
    return row;
  },

  async findById(ctx: TenantContext, id: string): Promise<Approval | undefined> {
    const rows = await db
      .select()
      .from(approvals)
      .where(and(eq(approvals.tenantId, ctx.tenantId), eq(approvals.id, id)))
      .limit(1);
    return rows[0];
  },

  async list(ctx: TenantContext, status?: Approval['status'], limit = 50): Promise<Approval[]> {
    const conditions = [eq(approvals.tenantId, ctx.tenantId)];
    if (status) conditions.push(eq(approvals.status, status));
    return db
      .select()
      .from(approvals)
      .where(and(...conditions))
      .orderBy(desc(approvals.createdAt))
      .limit(limit);
  },

  /** pending → approved/denied, once. Returns the row only when this call made the transition. */
  async decide(
    ctx: TenantContext,
    id: string,
    decision: 'approved' | 'denied',
    approvedBy: string,
  ): Promise<Approval | undefined> {
    const rows = await db
      .update(approvals)
      .set({ status: decision, approvedBy, decidedAt: sql`now()` })
      .where(
        and(
          eq(approvals.tenantId, ctx.tenantId),
          eq(approvals.id, id),
          eq(approvals.status, 'pending'),
          sql`${approvals.expiresAt} > now()`,
        ),
      )
      .returning();
    return rows[0];
  },

  async markOutcome(
    ctx: TenantContext,
    id: string,
    status: 'executed' | 'failed',
    result: Record<string, unknown>,
  ): Promise<void> {
    await db
      .update(approvals)
      .set({ status, result })
      .where(and(eq(approvals.tenantId, ctx.tenantId), eq(approvals.id, id), eq(approvals.status, 'approved')));
  },

  /** Cron sweep: expire stale pending proposals (tenant-wide, trusted maintenance path). */
  async expireStale(): Promise<number> {
    const rows = await db
      .update(approvals)
      .set({ status: 'expired' })
      .where(and(eq(approvals.status, 'pending'), lt(approvals.expiresAt, sql`now()`)))
      .returning({ id: approvals.id });
    return rows.length;
  },
};
