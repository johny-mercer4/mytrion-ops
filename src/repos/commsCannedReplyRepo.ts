import { and, asc, eq, isNull, or } from 'drizzle-orm';
import { db } from '../db/client.js';
import { mytrionCannedReplies, type MytrionCannedReply } from '../db/schema/index.js';
import type { TenantContext } from '../types/tenantContext.js';
import { firstOrThrow } from './util.js';

/**
 * Canned replies — team-shared reply templates.
 *
 * Tenant-scoped, not comms-reader-scoped: a template is not client data, so every internal agent in the
 * tenant may use every active template. `department` optionally narrows one to a queue's agents; the list
 * returns the global (NULL) templates plus that department's own.
 */
export const commsCannedReplyRepo = {
  /** Split out so the RBAC-leakage suite can assert the tenant binding on `.toSQL()` with no DB. */
  buildListQuery(ctx: TenantContext, opts: { department?: string } = {}) {
    const where = [
      eq(mytrionCannedReplies.tenantId, ctx.tenantId),
      eq(mytrionCannedReplies.active, true),
    ];
    if (opts.department) {
      const arm = or(
        isNull(mytrionCannedReplies.department),
        eq(mytrionCannedReplies.department, opts.department),
      );
      if (arm) where.push(arm);
    }
    return db
      .select()
      .from(mytrionCannedReplies)
      .where(and(...where))
      .orderBy(asc(mytrionCannedReplies.sortOrder), asc(mytrionCannedReplies.title));
  },

  async list(ctx: TenantContext, opts: { department?: string } = {}): Promise<MytrionCannedReply[]> {
    return this.buildListQuery(ctx, opts);
  },

  async create(
    ctx: TenantContext,
    input: { title: string; body: string; department?: string | null; createdByZohoUserId?: string | null },
  ): Promise<MytrionCannedReply> {
    const rows = await db
      .insert(mytrionCannedReplies)
      .values({
        tenantId: ctx.tenantId,
        title: input.title,
        body: input.body,
        department: input.department ?? null,
        createdByZohoUserId: input.createdByZohoUserId ?? null,
      })
      .returning();
    return firstOrThrow(rows, 'canned reply insert returned no row');
  },

  async findById(ctx: TenantContext, id: string): Promise<MytrionCannedReply | undefined> {
    const [row] = await db
      .select()
      .from(mytrionCannedReplies)
      .where(and(eq(mytrionCannedReplies.tenantId, ctx.tenantId), eq(mytrionCannedReplies.id, id)))
      .limit(1);
    return row;
  },

  async remove(ctx: TenantContext, id: string): Promise<boolean> {
    const rows = await db
      .delete(mytrionCannedReplies)
      .where(and(eq(mytrionCannedReplies.tenantId, ctx.tenantId), eq(mytrionCannedReplies.id, id)))
      .returning({ id: mytrionCannedReplies.id });
    return rows.length > 0;
  },
};
