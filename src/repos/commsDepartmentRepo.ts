import { and, asc, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { mytrionDepartmentConfig, type MytrionDepartmentConfig } from '../db/schema/index.js';
import type { TenantContext } from '../types/tenantContext.js';

/**
 * Per-department routing configuration: which queues accept work, the assignment strategy, and the
 * level-3 escalation manager.
 *
 * 0087 seeds ten rows per tenant with `manager_zoho_user_id` and `default_assignee_zoho_user_id`
 * deliberately NULL — those are chosen in Mytrion Admin against the HR directory, and a guessed
 * default would silently route real work to the wrong person. Callers must therefore treat a NULL as
 * "unrouted, fail loudly", never as a wildcard.
 *
 * The round-robin pool (`mytrion_department_agents`) is read from here too once assignment lands; this
 * module owns the config half first so the ticket create path can validate a target queue.
 */

export const commsDepartmentRepo = {
  buildListQuery(ctx: TenantContext, opts: { acceptsTicketsOnly?: boolean } = {}) {
    const where = [eq(mytrionDepartmentConfig.tenantId, ctx.tenantId)];
    if (opts.acceptsTicketsOnly) where.push(eq(mytrionDepartmentConfig.acceptsTickets, true));
    return db
      .select()
      .from(mytrionDepartmentConfig)
      .where(and(...where))
      .orderBy(asc(mytrionDepartmentConfig.department));
  },

  async list(
    ctx: TenantContext,
    opts: { acceptsTicketsOnly?: boolean } = {},
  ): Promise<MytrionDepartmentConfig[]> {
    return this.buildListQuery(ctx, opts);
  },

  async get(ctx: TenantContext, department: string): Promise<MytrionDepartmentConfig | undefined> {
    const [row] = await db
      .select()
      .from(mytrionDepartmentConfig)
      .where(
        and(
          eq(mytrionDepartmentConfig.tenantId, ctx.tenantId),
          eq(mytrionDepartmentConfig.department, department),
        ),
      )
      .limit(1);
    return row;
  },
};
