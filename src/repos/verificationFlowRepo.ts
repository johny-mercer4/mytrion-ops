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
import { and, asc, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  verificationCaseDocuments,
  verificationCaseEvents,
  verificationCasePhases,
  verificationCasePrincipals,
  verificationCases,
  verificationStatuses,
  type NewVerificationCaseDocument,
  type NewVerificationCasePrincipal,
  type VerificationCase,
  type VerificationCaseDocument,
  type VerificationCaseEvent,
  type VerificationCasePhase,
  type VerificationCasePrincipal,
  type VerificationPhaseStatus,
} from '../db/schema/index.js';
import type { TenantContext } from '../types/tenantContext.js';
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
  ownerZohoUserId: verificationCases.ownerZohoUserId,
  ownerName: verificationCases.ownerName,
  closedAt: verificationCases.closedAt,
  createdAt: verificationCases.createdAt,
  updatedAt: verificationCases.updatedAt,
} as const;

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

function tenant(ctx: TenantContext) {
  return eq(verificationCases.tenantId, ctx.tenantId);
}

function listWhere(ctx: TenantContext, filter: FlowListFilter) {
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
  return and(...clauses);
}

export const verificationFlowRepo = {
  /** Lookup rows — labels and the Sales board projection. Not tenant-scoped: they are global config. */
  async listStatuses(): Promise<
    Array<{ code: string; phaseCode: string; label: string; isTerminal: boolean; boardColumn: string | null }>
  > {
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
    return rows;
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
   * The Sales read model: applications this agent raised. Scoped by `submitted_by_zoho_user_id`
   * OR `owner_zoho_user_id` so a draft the agent has not submitted yet still appears on their board.
   */
  buildSalesListQuery(ctx: TenantContext, zohoUserId: string, filter: FlowListFilter = {}) {
    const { limit, offset } = normalizePagination(filter, 500);
    const ownership = or(
      eq(verificationCases.submittedByZohoUserId, zohoUserId),
      eq(verificationCases.ownerZohoUserId, zohoUserId),
    );
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
    const ownership = or(
      eq(verificationCases.submittedByZohoUserId, zohoUserId),
      eq(verificationCases.ownerZohoUserId, zohoUserId),
    );
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
    },
  ): Promise<VerificationCase | undefined> {
    const before = await this.findById(ctx, id);
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

    await verificationFlowRepo.upsertPhase(ctx, id, {
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

  // ---- phases ----

  async listPhases(ctx: TenantContext, caseId: string): Promise<VerificationCasePhase[]> {
    return db
      .select()
      .from(verificationCasePhases)
      .where(and(eq(verificationCasePhases.tenantId, ctx.tenantId), eq(verificationCasePhases.caseId, caseId)))
      .orderBy(asc(verificationCasePhases.phaseCode));
  },

  async upsertPhase(
    ctx: TenantContext,
    caseId: string,
    input: {
      phaseCode: string;
      status: VerificationPhaseStatus;
      outcome?: string | null;
      note?: string | null;
      decidedAt?: Date | null;
      decidedBy?: string | null;
      findings?: Record<string, unknown> | undefined;
    },
  ): Promise<VerificationCasePhase> {
    const now = new Date();
    const values = {
      tenantId: ctx.tenantId,
      caseId,
      phaseCode: input.phaseCode,
      status: input.status,
      outcome: input.outcome ?? null,
      note: input.note ?? null,
      decidedAt: input.decidedAt ?? null,
      decidedBy: input.decidedBy ?? null,
      ...(input.findings === undefined ? {} : { findings: input.findings }),
      updatedAt: now,
    } as typeof verificationCasePhases.$inferInsert;

    const rows = await db
      .insert(verificationCasePhases)
      .values({ ...values, startedAt: now })
      .onConflictDoUpdate({
        target: [
          verificationCasePhases.tenantId,
          verificationCasePhases.caseId,
          verificationCasePhases.phaseCode,
        ],
        set: {
          status: values.status,
          outcome: values.outcome,
          note: values.note,
          decidedAt: values.decidedAt,
          decidedBy: values.decidedBy,
          ...(input.findings === undefined ? {} : { findings: input.findings }),
          updatedAt: now,
        },
      })
      .returning();
    return firstOrThrow(rows, 'Failed to upsert verification phase');
  },

  // ---- principals ----

  async listPrincipals(ctx: TenantContext, caseId: string): Promise<VerificationCasePrincipal[]> {
    return db
      .select()
      .from(verificationCasePrincipals)
      .where(
        and(
          eq(verificationCasePrincipals.tenantId, ctx.tenantId),
          eq(verificationCasePrincipals.caseId, caseId),
        ),
      )
      .orderBy(asc(verificationCasePrincipals.createdAt));
  },

  async addPrincipal(
    ctx: TenantContext,
    input: Omit<NewVerificationCasePrincipal, 'tenantId'>,
  ): Promise<VerificationCasePrincipal> {
    const rows = await db
      .insert(verificationCasePrincipals)
      .values({ ...input, tenantId: ctx.tenantId })
      .returning();
    return firstOrThrow(rows, 'Failed to add principal');
  },

  async deletePrincipal(ctx: TenantContext, caseId: string, principalId: string): Promise<boolean> {
    const rows = await db
      .delete(verificationCasePrincipals)
      .where(
        and(
          eq(verificationCasePrincipals.tenantId, ctx.tenantId),
          eq(verificationCasePrincipals.caseId, caseId),
          eq(verificationCasePrincipals.id, principalId),
        ),
      )
      .returning({ id: verificationCasePrincipals.id });
    return rows.length > 0;
  },

  // ---- documents ----

  async listDocuments(ctx: TenantContext, caseId: string): Promise<VerificationCaseDocument[]> {
    return db
      .select()
      .from(verificationCaseDocuments)
      .where(
        and(
          eq(verificationCaseDocuments.tenantId, ctx.tenantId),
          eq(verificationCaseDocuments.caseId, caseId),
        ),
      )
      .orderBy(desc(verificationCaseDocuments.createdAt));
  },

  async addDocument(
    ctx: TenantContext,
    input: Omit<NewVerificationCaseDocument, 'tenantId'>,
  ): Promise<VerificationCaseDocument> {
    const rows = await db
      .insert(verificationCaseDocuments)
      .values({ ...input, tenantId: ctx.tenantId })
      .returning();
    return firstOrThrow(rows, 'Failed to record document');
  },

  async findDocument(
    ctx: TenantContext,
    caseId: string,
    documentId: string,
  ): Promise<VerificationCaseDocument | undefined> {
    const rows = await db
      .select()
      .from(verificationCaseDocuments)
      .where(
        and(
          eq(verificationCaseDocuments.tenantId, ctx.tenantId),
          eq(verificationCaseDocuments.caseId, caseId),
          eq(verificationCaseDocuments.id, documentId),
        ),
      )
      .limit(1);
    return firstOrUndefined(rows);
  },

  async updateDocument(
    ctx: TenantContext,
    caseId: string,
    documentId: string,
    patch: Partial<Omit<NewVerificationCaseDocument, 'id' | 'tenantId' | 'caseId'>>,
  ): Promise<VerificationCaseDocument | undefined> {
    const rows = await db
      .update(verificationCaseDocuments)
      .set({ ...patch, updatedAt: new Date() })
      .where(
        and(
          eq(verificationCaseDocuments.tenantId, ctx.tenantId),
          eq(verificationCaseDocuments.caseId, caseId),
          eq(verificationCaseDocuments.id, documentId),
        ),
      )
      .returning();
    return firstOrUndefined(rows);
  },

  async deleteDocument(ctx: TenantContext, caseId: string, documentId: string): Promise<boolean> {
    const rows = await db
      .delete(verificationCaseDocuments)
      .where(
        and(
          eq(verificationCaseDocuments.tenantId, ctx.tenantId),
          eq(verificationCaseDocuments.caseId, caseId),
          eq(verificationCaseDocuments.id, documentId),
        ),
      )
      .returning({ id: verificationCaseDocuments.id });
    return rows.length > 0;
  },

  /** Outstanding asks — `requested` rows are the Pending Documents list. */
  async listOutstandingRequests(
    ctx: TenantContext,
    caseId: string,
  ): Promise<VerificationCaseDocument[]> {
    return db
      .select()
      .from(verificationCaseDocuments)
      .where(
        and(
          eq(verificationCaseDocuments.tenantId, ctx.tenantId),
          eq(verificationCaseDocuments.caseId, caseId),
          eq(verificationCaseDocuments.status, 'requested'),
        ),
      )
      .orderBy(asc(verificationCaseDocuments.requestedAt));
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

  /** Bulk phase seed when a case is first released to the desk. */
  async seedPhases(
    ctx: TenantContext,
    caseId: string,
    phases: Array<{ phaseCode: string; status: VerificationPhaseStatus; note?: string | null }>,
  ): Promise<void> {
    if (phases.length === 0) return;
    const now = new Date();
    await db
      .insert(verificationCasePhases)
      .values(
        phases.map((p) => ({
          tenantId: ctx.tenantId,
          caseId,
          phaseCode: p.phaseCode,
          status: p.status,
          note: p.note ?? null,
          createdAt: now,
          updatedAt: now,
        })),
      )
      .onConflictDoNothing({
        target: [
          verificationCasePhases.tenantId,
          verificationCasePhases.caseId,
          verificationCasePhases.phaseCode,
        ],
      });
  },

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
