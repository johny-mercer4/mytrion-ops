import { and, asc, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { mytrionTicketTypes, type MytrionTicketType } from '../db/schema/index.js';
import type { TenantContext } from '../types/tenantContext.js';

/**
 * The ticket-type / escalation-reason catalog — the admin-owned replacement for three hardcoded
 * frontend arrays (49 ticket types, four department options, 11 escalation reasons).
 *
 * Read-only on purpose for now: the rows are seeded by 0088 and edited from Mytrion Admin later.
 * Nothing here takes a `targetDepartment` argument for a *write*, because the whole security value of
 * this table is that the queue comes from the catalog row and never from a request body.
 */

export type CommsCatalogKind = 'ticket' | 'escalation_reason';

export interface ListCatalogOptions {
  kind?: CommsCatalogKind;
  /** Omit for the picker (active only). Pass false to include deactivated rows for admin editing. */
  activeOnly?: boolean;
  /** Only types whose queue is this department — the "what can be filed at CS" question. */
  targetDepartment?: string;
  /** Only the subset exposed in the lightweight Requests tab. */
  requestableOnly?: boolean;
}

export const commsCatalogRepo = {
  /**
   * Split from `list` so the RBAC-leakage suite can assert the tenant binding on `.toSQL()` without a
   * database — the same discipline as `commsThreadRepo.buildListQuery`.
   */
  buildListQuery(ctx: TenantContext, opts: ListCatalogOptions = {}) {
    const where = [eq(mytrionTicketTypes.tenantId, ctx.tenantId)];
    if (opts.kind) where.push(eq(mytrionTicketTypes.kind, opts.kind));
    if (opts.activeOnly !== false) where.push(eq(mytrionTicketTypes.active, true));
    if (opts.targetDepartment) {
      where.push(eq(mytrionTicketTypes.targetDepartment, opts.targetDepartment));
    }
    if (opts.requestableOnly) where.push(eq(mytrionTicketTypes.requestable, true));

    // sortOrder then code: the seed assigns a distinct sortOrder per row, but a later admin insert can
    // collide on it, and a picker whose order changes between two loads looks broken.
    return db
      .select()
      .from(mytrionTicketTypes)
      .where(and(...where))
      .orderBy(asc(mytrionTicketTypes.sortOrder), asc(mytrionTicketTypes.code));
  },

  async list(ctx: TenantContext, opts: ListCatalogOptions = {}): Promise<MytrionTicketType[]> {
    return this.buildListQuery(ctx, opts);
  },

  /**
   * One catalog row by code, for the create path.
   *
   * Deliberately NOT filtered on `active`: the caller decides. A create must refuse a deactivated
   * type, but rendering an old ticket still has to resolve the label of a type that has since been
   * retired, and folding that into the lookup would make the two cases indistinguishable.
   */
  async byCode(ctx: TenantContext, code: string): Promise<MytrionTicketType | undefined> {
    const [row] = await db
      .select()
      .from(mytrionTicketTypes)
      .where(
        and(eq(mytrionTicketTypes.tenantId, ctx.tenantId), eq(mytrionTicketTypes.code, code)),
      )
      .limit(1);
    return row;
  },
};
