/**
 * The one write path for the shared verification case.
 *
 * Every method takes `ctx: TenantContext` first and every `where` leads with the tenant predicate —
 * there is no RLS behind this, the predicate IS the isolation (see verification-flow-rbac-leakage).
 *
 * `applyTransition` is the only way phase/status change, and it appends the audit event in the SAME
 * call. That is deliberate, and copied from `retentionCaseRepo.update`: an event written by a
 * separate opt-in step is an event somebody eventually forgets, and the timeline is the only record
 * of who decided what on a credit file.
 */
import { and, asc, desc, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  verificationCaseEvents,
  verificationCases,
  verificationStatuses,
  type VerificationCase,
  type VerificationCaseEvent,
  type VerificationPhaseStatus,
} from '../db/schema/index.js';
import type { TenantContext } from '../types/tenantContext.js';
import { verificationCaseAssetRepo } from './verificationCaseAssetRepo.js';
import { firstOrThrow, firstOrUndefined, normalizePagination } from './util.js';

/** Columns the list views project. Excludes `zoho_raw` — it is large and nothing in a list reads it. */
export const VERIFICATION_FLOW_LIST_COLUMNS = {
  id: verificationCases.id,
  companyName: verificationCases.companyName,
  firstName: verificationCases.firstName,
  lastName: verificationCases.lastName,
  email: verificationCases.email,
  phone: verificationCases.phone,
  applicantType: verificationCases.applicantType,
  // The desk queue's search box offers EIN / MC / USDOT, and `listWhere` already matches mc and dot
  // server-side — without them in the projection a client-side search over the page could not.
  ein: verificationCases.ein,
  mc: verificationCases.mc,
  dot: verificationCases.dot,
  underwritingRoute: verificationCases.underwritingRoute,
  verificationProcess: verificationCases.verificationProcess,
  phaseCode: verificationCases.phaseCode,
  statusCode: verificationCases.statusCode,
  trucksCount: verificationCases.trucksCount,
  fuelCardsRequested: verificationCases.fuelCardsRequested,
  requestedLimit: verificationCases.requestedLimit,
  approvedLimitAmount: verificationCases.approvedLimitAmount,
  intakeMissing: verificationCases.intakeMissing,
  submittedAt: verificationCases.submittedAt,
  submittedByZohoUserId: verificationCases.submittedByZohoUserId,
  /**
   * TWO different people. `owner_*` is the row's ASSIGNEE, which falls back to the Verification case
   * owner (`VERIFICATION_CASE_OWNER_NAME`) when a Deal reaches us with no owner in Zoho — so on those
   * rows it names a credit agent, not a Sales agent. `zoho_owner_*` is the DEAL's owner, which IS the
   * Sales agent, and null when Zoho has nobody. Any surface saying "Sales owner" means `zoho_owner_*`.
   */
  ownerZohoUserId: verificationCases.ownerZohoUserId,
  ownerName: verificationCases.ownerName,
  zohoOwnerId: verificationCases.zohoOwnerId,
  zohoOwnerName: verificationCases.zohoOwnerName,
  // The DESK's assignee, from Stage-0 routing. Projected so the queue can name the credit agent per
  // row instead of falling back to the tenant's configured one for every case alike.
  verificationOwnerZohoUserId: verificationCases.verificationOwnerZohoUserId,
  verificationOwnerName: verificationCases.verificationOwnerName,
  closedAt: verificationCases.closedAt,
  createdAt: verificationCases.createdAt,
  updatedAt: verificationCases.updatedAt,
} as const;

/**
 * The same projection as `VERIFICATION_FLOW_LIST_COLUMNS`, as raw SQL, so the one-round-trip queue
 * query in `verificationFlowBundleRepo` selects exactly the same columns. Two lists that must agree
 * are a drift risk; `verification-flow-projection.test.ts` asserts they still do.
 */
export const VERIFICATION_FLOW_LIST_COLUMN_SQL = sql.raw(
  [
    'id', 'company_name', 'first_name', 'last_name', 'email', 'phone',
    'applicant_type', 'ein', 'mc', 'dot',
    'underwriting_route', 'verification_process', 'phase_code', 'status_code',
    'trucks_count', 'fuel_cards_requested', 'requested_limit', 'approved_limit_amount',
    'intake_missing', 'submitted_at', 'submitted_by_zoho_user_id', 'owner_zoho_user_id',
    'owner_name', 'zoho_owner_id', 'zoho_owner_name',
    'verification_owner_zoho_user_id', 'verification_owner_name',
    'closed_at', 'created_at', 'updated_at',
  ].join(', '),
);

export type VerificationFlowListRow = {
  [K in keyof typeof VERIFICATION_FLOW_LIST_COLUMNS]: VerificationCase[K];
};

export interface FlowListFilter {
  limit?: number | undefined;
  offset?: number | undefined;
  statusCode?: string | undefined;
  phaseCode?: string | undefined;
  applicantType?: string | undefined;
  underwritingRoute?: string | undefined;
  /** true = green only, false = red only, undefined = both. */
  gate?: boolean | undefined;
  open?: boolean | undefined;
  search?: string | undefined;
}

/** What a transition changes. Mirrors `PhaseTransitionPatch` plus the actor. */
export interface TransitionInput {
  phaseCode: string;
  statusCode: string;
  phaseStatus: VerificationPhaseStatus;
  /** Phase the decision was recorded ON (may differ from the phase we move TO). */
  decidedPhase: string;
  outcome?: string | undefined;
  closed: boolean;
  eventType: string;
  eventNotes?: string | undefined;
  actorZohoUserId?: string | undefined;
  actorName?: string | undefined;
  findings?: Record<string, unknown> | undefined;
}

/** Process-lifetime cache for the seeded status lookup. See `listStatuses`. */
let statusCache:
  | Array<{ code: string; phaseCode: string; label: string; isTerminal: boolean; boardColumn: string | null }>
  | null = null;

function tenant(ctx: TenantContext) {
  return eq(verificationCases.tenantId, ctx.tenantId);
}

export function listWhere(ctx: TenantContext, filter: FlowListFilter): SQL {
  // Never undefined: the tenant predicate is always present, which is also the isolation guarantee.
  const clauses = [tenant(ctx)];
  if (filter.statusCode) clauses.push(eq(verificationCases.statusCode, filter.statusCode));
  if (filter.phaseCode) clauses.push(eq(verificationCases.phaseCode, filter.phaseCode));
  if (filter.applicantType) {
    clauses.push(sql`${verificationCases.applicantType} = ${filter.applicantType}`);
  }
  if (filter.underwritingRoute) {
    clauses.push(sql`${verificationCases.underwritingRoute} = ${filter.underwritingRoute}`);
  }
  if (filter.gate !== undefined) {
    clauses.push(eq(verificationCases.verificationProcess, filter.gate));
  }
  if (filter.open === true) clauses.push(isNull(verificationCases.closedAt));
  if (filter.search) {
    const needle = `%${filter.search.toLowerCase()}%`;
    const like = or(
      sql`lower(coalesce(${verificationCases.companyName}, '')) like ${needle}`,
      sql`lower(coalesce(${verificationCases.firstName}, '') || ' ' || coalesce(${verificationCases.lastName}, '')) like ${needle}`,
      sql`lower(coalesce(${verificationCases.email}, '')) like ${needle}`,
      sql`coalesce(${verificationCases.dot}, '') like ${needle}`,
      sql`coalesce(${verificationCases.mc}, '') like ${needle}`,
    );
    if (like) clauses.push(like);
  }
  return and(...clauses) as SQL;
}

export const verificationFlowRepo = {
  /**
   * Lookup rows — labels and the Sales board projection. Not tenant-scoped: they are global config.
   *
   * CACHED IN PROCESS. These twelve rows are seeded by migration 0121 and change only when another
   * migration changes them, but every list call on both desks read them — a ~300ms round trip to
   * Oregon for a static table. Cached for the process lifetime; a deploy is what changes them, and
   * a deploy restarts the process.
   */
  async listStatuses(): Promise<
    Array<{ code: string; phaseCode: string; label: string; isTerminal: boolean; boardColumn: string | null }>
  > {
    if (statusCache) return statusCache;
    const rows = await db
      .select({
        code: verificationStatuses.code,
        phaseCode: verificationStatuses.phaseCode,
        label: verificationStatuses.label,
        isTerminal: verificationStatuses.isTerminal,
        boardColumn: verificationStatuses.boardColumn,
      })
      .from(verificationStatuses)
      .orderBy(asc(verificationStatuses.sortOrder));
    statusCache = rows;
    return rows;
  },

  /** Drop the cache — for tests, and for anything that edits the lookup at runtime. */
  clearStatusCache(): void {
    statusCache = null;
  },

  async findById(ctx: TenantContext, id: string): Promise<VerificationCase | undefined> {
    const rows = await db
      .select()
      .from(verificationCases)
      .where(and(tenant(ctx), eq(verificationCases.id, id)))
      .limit(1);
    return firstOrUndefined(rows);
  },

  /**
   * The desk list query, unexecuted.
   *
   * Exposed so `verification-flow-rbac-leakage.test.ts` can call `.toSQL()` and assert the tenant
   * predicate is really in the emitted SQL. Testing against a fixture table cannot prove this — an
   * unscoped query on an empty database returns nothing and looks exactly like a scoped one.
   */
  buildListQuery(ctx: TenantContext, filter: FlowListFilter = {}) {
    const { limit, offset } = normalizePagination(filter, 2000);
    return db
      .select(VERIFICATION_FLOW_LIST_COLUMNS)
      .from(verificationCases)
      .where(listWhere(ctx, filter))
      .orderBy(desc(verificationCases.updatedAt))
      .limit(limit)
      .offset(offset);
  },

  async list(ctx: TenantContext, filter: FlowListFilter = {}): Promise<VerificationFlowListRow[]> {
    return this.buildListQuery(ctx, filter);
  },

  async count(ctx: TenantContext, filter: FlowListFilter = {}): Promise<number> {
    const rows = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(verificationCases)
      .where(listWhere(ctx, filter));
    return Number(firstOrUndefined(rows)?.n) || 0;
  },

  /**
   * The Sales read model: applications this agent is responsible for.
   *
   * Three columns, because an application can reach an agent three ways: they submitted it, they
   * were assigned it, or — the normal case now — the cron created it from a Deal they own in Zoho.
   * `zoho_owner_id` is what makes a cron-created application visible at all; without it every
   * generated application would be invisible to the only person who can complete it.
   */
  salesOwnership(zohoUserId: string) {
    return or(
      eq(verificationCases.submittedByZohoUserId, zohoUserId),
      eq(verificationCases.ownerZohoUserId, zohoUserId),
      eq(verificationCases.zohoOwnerId, zohoUserId),
    );
  },

  buildSalesListQuery(ctx: TenantContext, zohoUserId: string, filter: FlowListFilter = {}) {
    const { limit, offset } = normalizePagination(filter, 500);
    const ownership = this.salesOwnership(zohoUserId);
    return db
      .select(VERIFICATION_FLOW_LIST_COLUMNS)
      .from(verificationCases)
      .where(and(listWhere(ctx, filter), ownership))
      .orderBy(desc(verificationCases.updatedAt))
      .limit(limit)
      .offset(offset);
  },

  async listForSalesAgent(
    ctx: TenantContext,
    zohoUserId: string,
    filter: FlowListFilter = {},
  ): Promise<VerificationFlowListRow[]> {
    return this.buildSalesListQuery(ctx, zohoUserId, filter);
  },

  async countForSalesAgent(
    ctx: TenantContext,
    zohoUserId: string,
    filter: FlowListFilter = {},
  ): Promise<number> {
    const ownership = this.salesOwnership(zohoUserId);
    const rows = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(verificationCases)
      .where(and(listWhere(ctx, filter), ownership));
    return Number(firstOrUndefined(rows)?.n) || 0;
  },

  /** Desk counters. One query, `filter (where ...)` rather than N round trips. */
  async deskAggregates(ctx: TenantContext): Promise<{
    total: number;
    awaitingSales: number;
    workable: number;
    pendingDocs: number;
    managerReview: number;
    closed: number;
  }> {
    const rows = await db
      .select({
        total: sql<number>`count(*)::int`,
        awaitingSales: sql<number>`count(*) filter (where ${verificationCases.verificationProcess} = false)::int`,
        workable: sql<number>`count(*) filter (where ${verificationCases.verificationProcess} = true and ${verificationCases.closedAt} is null)::int`,
        pendingDocs: sql<number>`count(*) filter (where ${verificationCases.statusCode} = 'pending_docs')::int`,
        managerReview: sql<number>`count(*) filter (where ${verificationCases.statusCode} = 'manager_review')::int`,
        closed: sql<number>`count(*) filter (where ${verificationCases.closedAt} is not null)::int`,
      })
      .from(verificationCases)
      .where(tenant(ctx));
    const row = firstOrUndefined(rows);
    return {
      total: Number(row?.total) || 0,
      awaitingSales: Number(row?.awaitingSales) || 0,
      workable: Number(row?.workable) || 0,
      pendingDocs: Number(row?.pendingDocs) || 0,
      managerReview: Number(row?.managerReview) || 0,
      closed: Number(row?.closed) || 0,
    };
  },

  async insert(
    ctx: TenantContext,
    input: Omit<typeof verificationCases.$inferInsert, 'tenantId'>,
  ): Promise<VerificationCase> {
    const rows = await db
      .insert(verificationCases)
      .values({ ...input, tenantId: ctx.tenantId })
      .returning();
    const row = firstOrThrow(rows, 'Failed to create verification case');
    await appendEvent(ctx, {
      caseId: row.id,
      toPhase: row.phaseCode,
      toStatus: row.statusCode,
      eventType: 'created',
      actorZohoUserId: input.submittedByZohoUserId ?? null,
    });
    return row;
  },

  /**
   * Intake patch. Deliberately CANNOT set `verification_process`, `phase_code` or `status_code` —
   * the gate is computed by the service from the stored row, and phase/status move only through
   * `applyTransition`. Typing that out is what stops a route handler shortcutting either.
   */
  async patchIntake(
    ctx: TenantContext,
    id: string,
    patch: Partial<
      Omit<
        typeof verificationCases.$inferInsert,
        | 'id'
        | 'tenantId'
        | 'verificationProcess'
        | 'phaseCode'
        | 'statusCode'
        | 'closedAt'
        | 'outcomeCode'
      >
    >,
  ): Promise<VerificationCase | undefined> {
    const rows = await db
      .update(verificationCases)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(tenant(ctx), eq(verificationCases.id, id)))
      .returning();
    return firstOrUndefined(rows);
  },

  /** Set the gate and the missing list together — they are one fact and must not disagree. */
  async setGate(
    ctx: TenantContext,
    id: string,
    input: {
      complete: boolean;
      missing: string[];
      statusCode?: string | undefined;
      submittedByZohoUserId?: string | undefined;
      actorName?: string | undefined;
      /**
       * The row as the caller already read it. `before` is needed only to spot a gate FLIP, and
       * every caller has just SELECTed it to compute the verdict it is passing in — so re-reading it
       * here was a second Oregon round trip for a row already in hand.
       */
      before?: VerificationCase | undefined;
    },
  ): Promise<VerificationCase | undefined> {
    const before = input.before ?? (await this.findById(ctx, id));
    if (!before) return undefined;

    const set: Partial<typeof verificationCases.$inferInsert> = {
      verificationProcess: input.complete,
      intakeMissing: input.missing,
      updatedAt: new Date(),
    };
    if (input.statusCode) set.statusCode = input.statusCode;
    if (input.complete && !before.submittedAt) {
      set.submittedAt = new Date();
      if (input.submittedByZohoUserId) set.submittedByZohoUserId = input.submittedByZohoUserId;
    }

    const rows = await db
      .update(verificationCases)
      .set(set)
      .where(and(tenant(ctx), eq(verificationCases.id, id)))
      .returning();
    const row = firstOrUndefined(rows);
    if (!row) return undefined;

    // Only an actual gate flip is timeline-worthy; saving a still-incomplete form is not an event.
    if (before.verificationProcess !== row.verificationProcess) {
      await appendEvent(ctx, {
        caseId: id,
        fromStatus: before.statusCode,
        toStatus: row.statusCode,
        eventType: row.verificationProcess ? 'submitted' : 'intake_reopened',
        actorZohoUserId: input.submittedByZohoUserId ?? null,
        actorName: input.actorName ?? null,
        notes: row.verificationProcess
          ? 'Application complete — released to Verification.'
          : `Application reopened — ${input.missing.length} item(s) outstanding.`,
      });
    }
    return row;
  },

  /**
   * THE transition. Moves the case, stamps the phase row the decision was made on, and writes the
   * event — one call, so none of the three can happen without the others.
   */
  async applyTransition(
    ctx: TenantContext,
    id: string,
    input: TransitionInput,
  ): Promise<VerificationCase | undefined> {
    const before = await this.findById(ctx, id);
    if (!before) return undefined;

    const now = new Date();
    const set: Partial<typeof verificationCases.$inferInsert> = {
      phaseCode: input.phaseCode,
      statusCode: input.statusCode,
      updatedAt: now,
    };
    if (before.phaseCode !== input.phaseCode) set.phaseChangedAt = now;
    // closed_at is derived from terminality, and CLEARED when a case reopens — otherwise a
    // reopened application keeps a close date and drops out of every open-case filter.
    set.closedAt = input.closed ? now : null;
    if (input.closed) {
      set.outcomeCode = input.statusCode;
      set.decidedAt = now;
      if (input.actorZohoUserId) set.decidedBy = input.actorZohoUserId;
    }

    const rows = await db
      .update(verificationCases)
      .set(set)
      .where(and(tenant(ctx), eq(verificationCases.id, id)))
      .returning();
    const row = firstOrUndefined(rows);
    if (!row) return undefined;

    await verificationCaseAssetRepo.upsertPhase(ctx, id, {
      phaseCode: input.decidedPhase,
      status: input.phaseStatus,
      outcome: input.outcome ?? null,
      decidedAt: now,
      decidedBy: input.actorZohoUserId ?? null,
      note: input.eventNotes ?? null,
      findings: input.findings,
    });

    await appendEvent(ctx, {
      caseId: id,
      fromPhase: before.phaseCode,
      toPhase: row.phaseCode,
      fromStatus: before.statusCode,
      toStatus: row.statusCode,
      eventType: input.eventType,
      actorZohoUserId: input.actorZohoUserId ?? null,
      actorName: input.actorName ?? null,
      notes: input.eventNotes ?? null,
    });

    return row;
  },

  // ---- events ----

  async listEvents(
    ctx: TenantContext,
    caseId: string,
    limit = 100,
  ): Promise<VerificationCaseEvent[]> {
    return db
      .select()
      .from(verificationCaseEvents)
      .where(
        and(eq(verificationCaseEvents.tenantId, ctx.tenantId), eq(verificationCaseEvents.caseId, caseId)),
      )
      .orderBy(desc(verificationCaseEvents.occurredAt))
      .limit(Math.min(Math.max(limit, 1), 500));
  },

  appendEvent,

  /** Case labels for duplicate hits, resolved in one query rather than per hit. */
  async labelsFor(ctx: TenantContext, caseIds: string[]): Promise<Map<string, string>> {
    if (caseIds.length === 0) return new Map();
    const rows = await db
      .select({
        id: verificationCases.id,
        companyName: verificationCases.companyName,
        firstName: verificationCases.firstName,
        lastName: verificationCases.lastName,
      })
      .from(verificationCases)
      .where(and(tenant(ctx), inArray(verificationCases.id, caseIds)));
    return new Map(
      rows.map((r) => [
        r.id,
        r.companyName ?? [r.firstName, r.lastName].filter(Boolean).join(' ') ?? r.id,
      ]),
    );
  },
};

/**
 * Append-only. Exported through the repo object as well so callers never reach for the table.
 * Tenant id comes from ctx, never from the caller's payload.
 */
async function appendEvent(
  ctx: TenantContext,
  input: {
    caseId: string;
    fromPhase?: string | null;
    toPhase?: string | null;
    fromStatus?: string | null;
    toStatus?: string | null;
    eventType: string;
    actorZohoUserId?: string | null;
    actorName?: string | null;
    notes?: string | null;
  },
): Promise<void> {
  await db.insert(verificationCaseEvents).values({
    tenantId: ctx.tenantId,
    caseId: input.caseId,
    fromPhase: input.fromPhase ?? null,
    toPhase: input.toPhase ?? null,
    fromStatus: input.fromStatus ?? null,
    toStatus: input.toStatus ?? null,
    eventType: input.eventType,
    actorZohoUserId: input.actorZohoUserId ?? null,
    actorName: input.actorName ?? null,
    notes: input.notes ?? null,
  });
}
