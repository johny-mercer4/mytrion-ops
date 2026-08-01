import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  mytrionDepartmentAgents,
  mytrionDepartmentConfig,
  type MytrionDepartmentAgent,
  type MytrionDepartmentConfig,
  type TicketAssignmentStrategy,
} from '../db/schema/index.js';
import type { TenantContext } from '../types/tenantContext.js';
import { firstOrThrow } from './util.js';

/**
 * Per-department routing configuration and the explicit agent pool.
 *
 * 0091 seeds ten config rows per tenant with `manager_zoho_user_id` and
 * `default_assignee_zoho_user_id` deliberately NULL, and leaves `mytrion_department_agents` EMPTY.
 * Those values are chosen in Mytrion Admin against the HR directory — a guessed default would silently
 * route real work to the wrong person. So every read here must treat a NULL as "unrouted, fail loudly",
 * never as a wildcard.
 *
 * The pool serves two jobs: ticket round-robin for an operational department, and ESCALATION LEVEL 4 —
 * the `c-level` pool, which holds CEO and COO as separate rows distinguished by `role_title`, because
 * level 4 is more than one person and the escalating manager picks which.
 */

export interface DepartmentConfigPatch {
  /** FK → hr_departments.id. Departments are our own org data, so this is how a row gets its identity. */
  hrDepartmentId?: string | null | undefined;
  /** Display name, snapshotted from hr_departments.name. */
  label?: string | null | undefined;
  ticketAssignmentStrategy?: TicketAssignmentStrategy | undefined;
  requireOnline?: boolean | undefined;
  defaultAssigneeZohoUserId?: string | null | undefined;
  /** ESCALATION LEVEL 3 — the department manager an escalation rises to from the agent level. */
  managerZohoUserId?: string | null | undefined;
  managerName?: string | null | undefined;
  acceptsTickets?: boolean | undefined;
  acceptsEscalations?: boolean | undefined;
  slaHoursOverride?: number | null | undefined;
}

export interface PoolMemberInput {
  department: string;
  zohoUserId: string;
  displayName?: string | null | undefined;
  /** 'CEO' | 'COO' | 'Team Lead' | … Advisory only; routing always goes by zohoUserId. */
  roleTitle?: string | null | undefined;
  active?: boolean | undefined;
  acceptsNew?: boolean | undefined;
  maxOpen?: number | null | undefined;
  sortOrder?: number | undefined;
  addedByZohoUserId?: string | null | undefined;
}

export interface PoolMemberPatch {
  displayName?: string | null | undefined;
  roleTitle?: string | null | undefined;
  active?: boolean | undefined;
  acceptsNew?: boolean | undefined;
  maxOpen?: number | null | undefined;
  sortOrder?: number | undefined;
}

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

  /**
   * The config row for one HR department, or undefined when it has never been configured.
   *
   * Keyed on the HR id rather than on a slugified name, so a rename in HR does not orphan the routing
   * config — which is the whole reason 0093 added the link.
   */
  async getByHrDepartment(
    ctx: TenantContext,
    hrDepartmentId: string,
  ): Promise<MytrionDepartmentConfig | undefined> {
    const [row] = await db
      .select()
      .from(mytrionDepartmentConfig)
      .where(
        and(
          eq(mytrionDepartmentConfig.tenantId, ctx.tenantId),
          eq(mytrionDepartmentConfig.hrDepartmentId, hrDepartmentId),
        ),
      )
      .limit(1);
    return row;
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

  /**
   * Create or patch one department's config.
   *
   * An UPSERT rather than an UPDATE because 0091 only seeded ten departments: `maintenance` and
   * `marketing` have no row, and an admin configuring one of those must not get a silent no-op. Only the
   * keys present in the patch are written, so setting a manager cannot accidentally reset the strategy.
   */
  async upsertConfig(
    ctx: TenantContext,
    department: string,
    patch: DepartmentConfigPatch,
  ): Promise<MytrionDepartmentConfig> {
    const now = new Date();
    // Built key-by-key so an ABSENT key means "leave it alone" while an explicit null means "clear it".
    // A spread of the whole patch would turn every unspecified column into undefined, which Drizzle
    // omits from the UPDATE — the same outcome by accident rather than by design.
    const set: Partial<typeof mytrionDepartmentConfig.$inferInsert> = { updatedAt: now };
    if (patch.hrDepartmentId !== undefined) set.hrDepartmentId = patch.hrDepartmentId;
    if (patch.label !== undefined) set.label = patch.label;
    if (patch.ticketAssignmentStrategy !== undefined) {
      set.ticketAssignmentStrategy = patch.ticketAssignmentStrategy;
    }
    if (patch.requireOnline !== undefined) set.requireOnline = patch.requireOnline;
    if (patch.defaultAssigneeZohoUserId !== undefined) {
      set.defaultAssigneeZohoUserId = patch.defaultAssigneeZohoUserId;
    }
    if (patch.managerZohoUserId !== undefined) set.managerZohoUserId = patch.managerZohoUserId;
    if (patch.managerName !== undefined) set.managerName = patch.managerName;
    if (patch.acceptsTickets !== undefined) set.acceptsTickets = patch.acceptsTickets;
    if (patch.acceptsEscalations !== undefined) set.acceptsEscalations = patch.acceptsEscalations;
    if (patch.slaHoursOverride !== undefined) set.slaHoursOverride = patch.slaHoursOverride;

    const rows = await db
      .insert(mytrionDepartmentConfig)
      .values({ tenantId: ctx.tenantId, department, ...set, createdAt: now })
      .onConflictDoUpdate({
        target: [mytrionDepartmentConfig.tenantId, mytrionDepartmentConfig.department],
        set,
      })
      .returning();
    return firstOrThrow(rows, 'department config upsert returned no row');
  },

  // -------------------------------------------------------------------------------------------
  // Pool (mytrion_department_agents)
  // -------------------------------------------------------------------------------------------

  buildPoolQuery(ctx: TenantContext, opts: { departments?: string[]; activeOnly?: boolean } = {}) {
    const where = [eq(mytrionDepartmentAgents.tenantId, ctx.tenantId)];
    if (opts.departments && opts.departments.length > 0) {
      where.push(inArray(mytrionDepartmentAgents.department, opts.departments));
    }
    if (opts.activeOnly) where.push(eq(mytrionDepartmentAgents.active, true));
    return db
      .select()
      .from(mytrionDepartmentAgents)
      .where(and(...where))
      .orderBy(
        asc(mytrionDepartmentAgents.department),
        asc(mytrionDepartmentAgents.sortOrder),
        asc(mytrionDepartmentAgents.zohoUserId),
      );
  },

  async listPool(
    ctx: TenantContext,
    opts: { departments?: string[]; activeOnly?: boolean } = {},
  ): Promise<MytrionDepartmentAgent[]> {
    return this.buildPoolQuery(ctx, opts);
  },

  async getPoolMember(
    ctx: TenantContext,
    department: string,
    zohoUserId: string,
  ): Promise<MytrionDepartmentAgent | undefined> {
    const [row] = await db
      .select()
      .from(mytrionDepartmentAgents)
      .where(
        and(
          eq(mytrionDepartmentAgents.tenantId, ctx.tenantId),
          eq(mytrionDepartmentAgents.department, department),
          eq(mytrionDepartmentAgents.zohoUserId, zohoUserId),
        ),
      )
      .limit(1);
    return row;
  },

  /**
   * Add someone to a pool, or revive/refresh an existing seat.
   *
   * Idempotent on (tenant, department, zoho_user_id) so re-adding a person who was deactivated brings
   * them back rather than failing — the alternative is an admin having to know whether a row already
   * exists before clicking Add. `last_assigned_at` and `assigned_count` are deliberately NOT reset: a
   * returning agent keeps their place in the least-recently-assigned rotation, and zeroing the counter
   * would hand them a burst of work as a side effect of an edit.
   */
  async upsertPoolMember(
    ctx: TenantContext,
    input: PoolMemberInput,
  ): Promise<MytrionDepartmentAgent> {
    const now = new Date();
    const set: Partial<typeof mytrionDepartmentAgents.$inferInsert> = { updatedAt: now };
    if (input.displayName !== undefined) set.displayName = input.displayName;
    if (input.roleTitle !== undefined) set.roleTitle = input.roleTitle;
    set.active = input.active ?? true;
    set.acceptsNew = input.acceptsNew ?? true;
    if (input.maxOpen !== undefined) set.maxOpen = input.maxOpen;
    if (input.sortOrder !== undefined) set.sortOrder = input.sortOrder;

    const rows = await db
      .insert(mytrionDepartmentAgents)
      .values({
        tenantId: ctx.tenantId,
        department: input.department,
        zohoUserId: input.zohoUserId,
        addedByZohoUserId: input.addedByZohoUserId ?? null,
        createdAt: now,
        ...set,
      })
      .onConflictDoUpdate({
        target: [
          mytrionDepartmentAgents.tenantId,
          mytrionDepartmentAgents.department,
          mytrionDepartmentAgents.zohoUserId,
        ],
        set,
      })
      .returning();
    return firstOrThrow(rows, 'department pool upsert returned no row');
  },

  async updatePoolMember(
    ctx: TenantContext,
    department: string,
    zohoUserId: string,
    patch: PoolMemberPatch,
  ): Promise<MytrionDepartmentAgent | undefined> {
    const set: Partial<typeof mytrionDepartmentAgents.$inferInsert> = { updatedAt: new Date() };
    if (patch.displayName !== undefined) set.displayName = patch.displayName;
    if (patch.roleTitle !== undefined) set.roleTitle = patch.roleTitle;
    if (patch.active !== undefined) set.active = patch.active;
    if (patch.acceptsNew !== undefined) set.acceptsNew = patch.acceptsNew;
    if (patch.maxOpen !== undefined) set.maxOpen = patch.maxOpen;
    if (patch.sortOrder !== undefined) set.sortOrder = patch.sortOrder;

    const rows = await db
      .update(mytrionDepartmentAgents)
      .set(set)
      .where(
        and(
          eq(mytrionDepartmentAgents.tenantId, ctx.tenantId),
          eq(mytrionDepartmentAgents.department, department),
          eq(mytrionDepartmentAgents.zohoUserId, zohoUserId),
        ),
      )
      .returning();
    return rows[0];
  },

  /**
   * ROUND-ROBIN: claim the next eligible seat, atomically.
   *
   * One statement, and it must stay one statement. The obvious two-step — SELECT the least-recently-assigned
   * agent, then UPDATE them — hands the SAME person to two tickets created in the same instant, which is
   * exactly the failure round-robin exists to prevent. Instead the inner SELECT takes a row lock with
   * `FOR UPDATE SKIP LOCKED`, so a concurrent claim walks past the locked row to the next candidate rather
   * than blocking or colliding.
   *
   * Ordering IS the strategy:
   *   round_robin  `last_assigned_at` ascending, NULLS FIRST — the least recently given work goes next, and
   *                a newly added member (NULL) goes first because they are owed work. Self-healing: an agent
   *                who was away has a stale timestamp and is first in line when they return.
   *   least_open   fewest open tickets first, then the same recency tiebreak. Better when handling times
   *                vary wildly; worse at fairness, which is why round_robin is the default.
   *
   * `excludeZohoUserIds` keeps a reassignment from handing the ticket back to whoever just gave it up.
   * Returns undefined when nobody is eligible — the caller leaves the ticket unassigned in the queue and
   * journals why, rather than failing the create.
   */
  async claimNextAgent(
    ctx: TenantContext,
    department: string,
    opts: {
      strategy?: TicketAssignmentStrategy;
      /** Zoho ids considered live. Undefined = do not filter on presence at all. */
      onlineZohoUserIds?: string[] | undefined;
      excludeZohoUserIds?: string[];
    } = {},
  ): Promise<MytrionDepartmentAgent | undefined> {
    const strategy = opts.strategy ?? 'round_robin';
    const online = opts.onlineZohoUserIds;
    const exclude = opts.excludeZohoUserIds ?? [];

    // EVERY reference inside the subquery must be to the alias `a`, written out literally. Using the
    // Drizzle column helpers here renders `"mytrion_department_agents"."last_assigned_at"`, which inside a
    // subquery over the SAME table is a CORRELATED reference to the outer UPDATE row — so ORDER BY became
    // constant per row and the rotation silently handed every ticket to the same agent.
    const openLoad = sql`(
      SELECT count(*) FROM mytrion_tickets t
       WHERE t.tenant_id = a.tenant_id
         AND t.assignee_zoho_user_id = a.zoho_user_id
         AND t.status IN ('open', 'in_progress', 'pending_requester', 'on_hold', 'escalated')
    )`;

    const order =
      strategy === 'least_open'
        ? sql`${openLoad} ASC, a.last_assigned_at ASC NULLS FIRST`
        : sql`a.last_assigned_at ASC NULLS FIRST`;

    const onlineFilter =
      online === undefined
        ? sql`TRUE`
        : online.length === 0
          ? sql`FALSE`
          : sql`a.zoho_user_id IN ${online}`;

    const excludeFilter = exclude.length === 0 ? sql`TRUE` : sql`a.zoho_user_id NOT IN ${exclude}`;

    // Bounded retry, because `SKIP LOCKED` STARVES under a burst. With three agents and twelve tickets
    // arriving together, a claim that walks past every locked row finds nothing and the ticket would be
    // filed unassigned — the opposite of what round-robin is for. The locks are held only for the length of
    // this one UPDATE, so a few milliseconds is enough for the winner to commit and free the row. If nobody
    // is genuinely eligible the retries cost ~40ms and still return undefined.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const rows = await db
        .update(mytrionDepartmentAgents)
        .set({
          lastAssignedAt: new Date(),
          assignedCount: sql`${mytrionDepartmentAgents.assignedCount} + 1`,
          updatedAt: new Date(),
        })
        .where(
          sql`${mytrionDepartmentAgents.id} = (
            SELECT a.id FROM mytrion_department_agents a
             WHERE a.tenant_id = ${ctx.tenantId}
               AND a.department = ${department}
               AND a.active = TRUE
               AND a.accepts_new = TRUE
               AND (a.max_open IS NULL OR ${openLoad} < a.max_open)
               AND ${onlineFilter}
               AND ${excludeFilter}
             ORDER BY ${order}
             LIMIT 1
             FOR UPDATE SKIP LOCKED
          )`,
        )
        .returning();
      const seat = rows[0];
      if (seat) return seat;
      if (attempt < 4) await new Promise((r) => setTimeout(r, 10 * (attempt + 1)));
    }
    return undefined;
  },

  /**
   * Give back a claim.
   *
   * Used when the ticket write fails after an agent was already claimed: without this they would sit at the
   * back of the rotation having received nothing, and `assigned_count` would over-report their load.
   */
  async releaseClaim(ctx: TenantContext, department: string, zohoUserId: string): Promise<void> {
    await db
      .update(mytrionDepartmentAgents)
      .set({
        assignedCount: sql`GREATEST(${mytrionDepartmentAgents.assignedCount} - 1, 0)`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(mytrionDepartmentAgents.tenantId, ctx.tenantId),
          eq(mytrionDepartmentAgents.department, department),
          eq(mytrionDepartmentAgents.zohoUserId, zohoUserId),
        ),
      );
    // `last_assigned_at` is deliberately NOT rewound. Restoring it would need the previous value, and the
    // only cost of leaving it is that this agent waits one extra turn — far better than a rollback race
    // handing the next two tickets to the same person.
  },

  /**
   * Remove a seat outright.
   *
   * Distinct from `active: false`. Deactivating keeps the rotation history, which is what an admin wants
   * for someone on leave; deleting is for a seat created by mistake. The escalation chain snapshots its
   * assignee per hop, so removing someone never rewrites an escalation already in flight.
   */
  async removePoolMember(
    ctx: TenantContext,
    department: string,
    zohoUserId: string,
  ): Promise<boolean> {
    const rows = await db
      .delete(mytrionDepartmentAgents)
      .where(
        and(
          eq(mytrionDepartmentAgents.tenantId, ctx.tenantId),
          eq(mytrionDepartmentAgents.department, department),
          eq(mytrionDepartmentAgents.zohoUserId, zohoUserId),
        ),
      )
      .returning({ id: mytrionDepartmentAgents.id });
    return rows.length > 0;
  },
};
