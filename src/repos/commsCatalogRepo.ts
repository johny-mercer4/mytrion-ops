import { and, asc, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  mytrionTicketTypes,
  type CommsTicketPriority,
  type MytrionTicketType,
} from '../db/schema/index.js';
import type { TenantContext } from '../types/tenantContext.js';

/**
 * The ticket-type / escalation-reason catalog — the admin-owned replacement for three hardcoded
 * frontend arrays (49 ticket types, four department options, 11 escalation reasons).
 *
 * Rows are seeded by 0092 and edited from Mytrion Admin. Note what the write path does NOT allow:
 * `code` and `kind` are immutable, because every historical ticket snapshots the code and `kind` decides
 * whether a row is a ticket type or an escalation reason. `targetDepartment` IS editable — retargeting a
 * whole family of types without a deploy is the reason this table exists — but only through an admin
 * route, never from a create request, which is what keeps "the queue comes from the catalog" true.
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

/** Admin-editable fields. An absent key leaves the column alone; an explicit null clears it. */
export interface CatalogPatch {
  label?: string | undefined;
  group?: string | null | undefined;
  targetDepartment?: string | null | undefined;
  defaultPriority?: CommsTicketPriority | null | undefined;
  slaHours?: number | null | undefined;
  /** For kind='escalation_reason': ESCALATION LEVEL 2, the user this reason falls to. */
  defaultAssigneeZohoUserId?: string | null | undefined;
  requestable?: boolean | undefined;
  requiresCarrier?: boolean | undefined;
  requiresCard?: boolean | undefined;
  automationKey?: string | null | undefined;
  active?: boolean | undefined;
  sortOrder?: number | undefined;
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

  /**
   * Patch the admin-editable fields of one catalog row.
   *
   * The patch type is a deliberate ALLOWLIST, not `Partial<MytrionTicketType>`. `code` is referenced by
   * every historical ticket's snapshot and by the frontend's automation lookup, and `kind` decides
   * whether a row is a ticket type or an escalation reason — letting either be edited would rewrite the
   * meaning of rows already in flight. Retargeting `targetDepartment` IS allowed, because moving a whole
   * family of types to another queue without a deploy is the reason this table exists.
   *
   * `defaultAssigneeZohoUserId` is the one an admin will touch most: on a `kind='escalation_reason'` row
   * it is ESCALATION LEVEL 2, the user the reason falls to. All 11 seeded reasons have it NULL, and an
   * escalation on an unrouted reason is refused at raise time rather than parked in nobody's inbox.
   */
  async updateByCode(
    ctx: TenantContext,
    code: string,
    patch: CatalogPatch,
  ): Promise<MytrionTicketType | undefined> {
    const set: Partial<typeof mytrionTicketTypes.$inferInsert> = { updatedAt: new Date() };
    if (patch.label !== undefined) set.label = patch.label;
    if (patch.group !== undefined) set.group = patch.group;
    if (patch.targetDepartment !== undefined) set.targetDepartment = patch.targetDepartment;
    if (patch.defaultPriority !== undefined) set.defaultPriority = patch.defaultPriority;
    if (patch.slaHours !== undefined) set.slaHours = patch.slaHours;
    if (patch.defaultAssigneeZohoUserId !== undefined) {
      set.defaultAssigneeZohoUserId = patch.defaultAssigneeZohoUserId;
    }
    if (patch.requestable !== undefined) set.requestable = patch.requestable;
    if (patch.requiresCarrier !== undefined) set.requiresCarrier = patch.requiresCarrier;
    if (patch.requiresCard !== undefined) set.requiresCard = patch.requiresCard;
    if (patch.automationKey !== undefined) set.automationKey = patch.automationKey;
    if (patch.active !== undefined) set.active = patch.active;
    if (patch.sortOrder !== undefined) set.sortOrder = patch.sortOrder;

    const rows = await db
      .update(mytrionTicketTypes)
      .set(set)
      .where(
        and(eq(mytrionTicketTypes.tenantId, ctx.tenantId), eq(mytrionTicketTypes.code, code)),
      )
      .returning();
    return rows[0];
  },
};
