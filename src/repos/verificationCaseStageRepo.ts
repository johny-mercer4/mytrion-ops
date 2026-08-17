import { and, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  verificationCaseStages,
  type NewVerificationCaseStage,
  type VerificationCaseStage,
  type VerificationStageStatus,
} from '../db/schema/index.js';
import type { TenantContext } from '../types/tenantContext.js';
import { firstOrThrow, isUniqueViolation } from './util.js';

export interface StageUpsertInput {
  stageId: string;
  status: VerificationStageStatus;
  result?: Record<string, unknown>;
  error?: string | null;
  ranAt?: Date | null;
  approvedAt?: Date | null;
  approvedBy?: string | null;
}

export const verificationCaseStageRepo = {
  async listForCase(ctx: TenantContext, caseId: string): Promise<VerificationCaseStage[]> {
    return db
      .select()
      .from(verificationCaseStages)
      .where(
        and(eq(verificationCaseStages.tenantId, ctx.tenantId), eq(verificationCaseStages.caseId, caseId)),
      );
  },

  async seedForCase(ctx: TenantContext, caseId: string, stageIds: readonly string[]): Promise<void> {
    const values: NewVerificationCaseStage[] = stageIds.map((stageId, index) => ({
      tenantId: ctx.tenantId,
      caseId,
      stageId,
      status: index === 0 ? 'ready' : 'pending',
    }));
    try {
      await db.insert(verificationCaseStages).values(values);
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
    }
  },

  async upsertMany(ctx: TenantContext, caseId: string, inputs: StageUpsertInput[]): Promise<void> {
    for (const input of inputs) {
      const existing = await db
        .select({ id: verificationCaseStages.id })
        .from(verificationCaseStages)
        .where(
          and(
            eq(verificationCaseStages.tenantId, ctx.tenantId),
            eq(verificationCaseStages.caseId, caseId),
            eq(verificationCaseStages.stageId, input.stageId),
          ),
        )
        .limit(1);
      const row = existing[0];
      if (row) {
        await db
          .update(verificationCaseStages)
          .set({
            status: input.status,
            result: input.result ?? {},
            error: input.error ?? null,
            ranAt: input.ranAt ?? null,
            approvedAt: input.approvedAt ?? null,
            approvedBy: input.approvedBy ?? null,
            updatedAt: new Date(),
          })
          .where(eq(verificationCaseStages.id, row.id));
        continue;
      }
      const inserted = await db
        .insert(verificationCaseStages)
        .values({
          tenantId: ctx.tenantId,
          caseId,
          stageId: input.stageId,
          status: input.status,
          result: input.result ?? {},
          error: input.error ?? null,
          ranAt: input.ranAt ?? null,
          approvedAt: input.approvedAt ?? null,
          approvedBy: input.approvedBy ?? null,
        })
        .returning();
      firstOrThrow(inserted, 'verification_case_stages insert returned no row');
    }
  },
};
