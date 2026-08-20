/**
 * Per-case children of a verification case: the phase rail, the principals and the documents.
 *
 * Split out of `verificationFlowRepo` purely for the 600-line cap — these are the same concern and
 * the same tenant discipline: every method takes `ctx` first and every `where` leads with the
 * tenant predicate on the CHILD table, so a case id guessed from another tenant returns nothing.
 */
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  verificationCaseDocuments,
  verificationCasePhases,
  verificationCasePrincipals,
  type NewVerificationCaseDocument,
  type NewVerificationCasePrincipal,
  type VerificationCaseDocument,
  type VerificationCasePhase,
  type VerificationCasePrincipal,
  type VerificationPhaseStatus,
} from '../db/schema/index.js';
import type { TenantContext } from '../types/tenantContext.js';
import { firstOrThrow, firstOrUndefined } from './util.js';

export const verificationCaseAssetRepo = {
  async listPhases(ctx: TenantContext, caseId: string): Promise<VerificationCasePhase[]> {
    return db
      .select()
      .from(verificationCasePhases)
      .where(and(eq(verificationCasePhases.tenantId, ctx.tenantId), eq(verificationCasePhases.caseId, caseId)))
      .orderBy(asc(verificationCasePhases.phaseCode));
  },

  /**
   * Send a phase back to In progress, and un-decide everything downstream of it.
   *
   * The desk asked for "return to a previous stage, refix" and a phase machine that only ever moved
   * forward could not express it: `upsertPhase` writes a decision, it cannot withdraw one.
   *
   * WHY DOWNSTREAM PHASES RESET. A phase 5 sign-off was made on facts phase 3 has now reopened. Keeping
   * it green would leave a rail claiming five passes on a case that has re-entered the third, and the
   * reviewer would have to remember which of those greens still means anything. They go back to
   * `not_started`.
   *
   * WHY `findings` AND `note` SURVIVE. Only the VERDICT is withdrawn. The screening hits, the credit
   * marks and the banking checks recorded last time are the reviewer's working notes — a reopen that
   * blanked them would make "refix" mean "start again from nothing", and the case timeline still holds
   * the reopen itself. Status returns to not-started; what was learned stays on the row.
   *
   * `codesAfter` is the caller's, not derived here: phase ORDER lives in the flow module's catalog and
   * a repo that re-derived it would be a second copy of the ten-phase sequence.
   */
  async reopenPhase(
    ctx: TenantContext,
    caseId: string,
    input: { phaseCode: string; codesAfter: readonly string[] },
  ): Promise<void> {
    const now = new Date();
    const withdrawn = {
      outcome: null,
      decidedAt: null,
      decidedBy: null,
      updatedAt: now,
    } as const;

    await db
      .update(verificationCasePhases)
      .set({ ...withdrawn, status: 'in_progress', startedAt: now })
      .where(
        and(
          eq(verificationCasePhases.tenantId, ctx.tenantId),
          eq(verificationCasePhases.caseId, caseId),
          eq(verificationCasePhases.phaseCode, input.phaseCode),
        ),
      );

    if (input.codesAfter.length === 0) return;
    await db
      .update(verificationCasePhases)
      .set({ ...withdrawn, status: 'not_started' })
      .where(
        and(
          eq(verificationCasePhases.tenantId, ctx.tenantId),
          eq(verificationCasePhases.caseId, caseId),
          inArray(verificationCasePhases.phaseCode, [...input.codesAfter]),
        ),
      );
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

  /**
   * Record what an AUTOMATION observed, without ever touching what a reviewer decided.
   *
   * WHY THIS IS NOT `upsertPhase`. That method's conflict branch writes `outcome`, `note`,
   * `decidedAt` and `decidedBy` unconditionally as `?? null`, because its job is to RECORD a
   * decision. An automation calls it with only `{ status: 'in_progress', findings }` — so on a phase
   * that had already passed, it nulled the outcome and the decider and pushed the status back to
   * in_progress. Silently: no `phase_reopened` event, no downstream phase reset, and
   * `verification_cases.phase_code` / `status_code` still pointing forward at the phase after it. The
   * rail said "in progress" while the case said "past it", and nobody was told the pass had gone.
   * Withdrawing a verdict is `reopenPhase`'s job, and it demands a reason and writes the event.
   *
   * So this writes `findings` and nothing else that matters, and it advances `status` ONLY while the
   * phase is undecided — the `case` expression is the invariant, in SQL, where the next automation
   * cannot forget it. A re-run on a decided phase updates its findings and leaves the verdict alone.
   */
  async recordPhaseObservation(
    ctx: TenantContext,
    caseId: string,
    input: {
      phaseCode: string;
      status: VerificationPhaseStatus;
      findings: Record<string, unknown>;
    },
  ): Promise<VerificationCasePhase> {
    const now = new Date();
    const rows = await db
      .insert(verificationCasePhases)
      .values({
        tenantId: ctx.tenantId,
        caseId,
        phaseCode: input.phaseCode,
        status: input.status,
        findings: input.findings,
        startedAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          verificationCasePhases.tenantId,
          verificationCasePhases.caseId,
          verificationCasePhases.phaseCode,
        ],
        set: {
          status: sql`case when ${verificationCasePhases.outcome} is null then ${input.status} else ${verificationCasePhases.status} end`,
          findings: input.findings,
          updatedAt: now,
        },
      })
      .returning();
    return firstOrThrow(rows, 'Failed to record verification phase observation');
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
};
