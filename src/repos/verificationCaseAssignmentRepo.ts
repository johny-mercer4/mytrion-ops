/**
 * Who the Verification desk gave each case to — the append-only history, and the fairness probe
 * Stage-0 routing reads from it.
 *
 * Its own repo file rather than more methods on `verificationFlowRepo`, which is at 540 lines against
 * the 600-line cap and already owns a different concern: the case's own transitions. Same split as
 * `verificationCaseAssetRepo` / `verificationScreeningRepo`.
 *
 * Every method takes `ctx` first and leads its `where` with the tenant predicate. There is no RLS
 * behind this — the predicate IS the isolation.
 */
import { and, eq, inArray, max, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  verificationCaseAssignments,
  type VerificationCaseAssignment,
} from '../db/schema/index.js';
import type { TenantContext } from '../types/tenantContext.js';

const tenant = (ctx: TenantContext) => eq(verificationCaseAssignments.tenantId, ctx.tenantId);

export const verificationCaseAssignmentRepo = {
  /**
   * When each of these agents was LAST given a case.
   *
   * One statement for the whole candidate list, not one per agent: the credit desk is small today but
   * this runs inside the Deal poller's per-row loop, and a query per agent per case is how a poller
   * starts timing out. An agent absent from the result has never been assigned — which is what makes
   * them go first (the NULLS-FIRST rule `mytrion_comms_routing` states for its own claim).
   */
  async lastAssignedAt(
    ctx: TenantContext,
    zohoUserIds: readonly string[],
  ): Promise<Map<string, Date>> {
    if (zohoUserIds.length === 0) return new Map();
    const rows = await db
      .select({
        zohoUserId: verificationCaseAssignments.zohoUserId,
        at: max(verificationCaseAssignments.assignedAt),
      })
      .from(verificationCaseAssignments)
      .where(and(tenant(ctx), inArray(verificationCaseAssignments.zohoUserId, [...zohoUserIds])))
      .groupBy(verificationCaseAssignments.zohoUserId);
    const out = new Map<string, Date>();
    for (const row of rows) {
      if (row.at) out.set(row.zohoUserId, row.at);
    }
    return out;
  },

  /** Record an assignment. The case row's own `verification_owner_*` pair is written beside this. */
  async record(
    ctx: TenantContext,
    input: {
      caseId: string;
      zohoUserId: string;
      assigneeName?: string | null;
      previousZohoUserId?: string | null;
      reason?: string;
      assignedByZohoUserId?: string | null;
    },
  ): Promise<VerificationCaseAssignment> {
    const rows = await db
      .insert(verificationCaseAssignments)
      .values({
        tenantId: ctx.tenantId,
        caseId: input.caseId,
        zohoUserId: input.zohoUserId,
        assigneeName: input.assigneeName ?? null,
        previousZohoUserId: input.previousZohoUserId ?? null,
        ...(input.reason ? { reason: input.reason } : {}),
        assignedByZohoUserId: input.assignedByZohoUserId ?? null,
      })
      .returning();
    const row = rows[0];
    if (!row) throw new Error('Failed to record a verification case assignment');
    return row;
  },

  /** One case's history, newest first — "why is this mine". */
  async listForCase(ctx: TenantContext, caseId: string): Promise<VerificationCaseAssignment[]> {
    return db
      .select()
      .from(verificationCaseAssignments)
      .where(and(tenant(ctx), eq(verificationCaseAssignments.caseId, caseId)))
      .orderBy(sql`${verificationCaseAssignments.assignedAt} desc`);
  },
};
