import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { verificationIngestState, type VerificationIngestState } from '../db/schema/index.js';
import type { TenantContext } from '../types/tenantContext.js';
import { firstOrThrow, firstOrUndefined } from './util.js';

const LOOKBACK_DAYS = 30;

export function defaultDealWatermark(now = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - LOOKBACK_DAYS);
  return d.toISOString().slice(0, 10);
}

export const verificationIngestStateRepo = {
  async getOrCreate(ctx: TenantContext): Promise<VerificationIngestState> {
    const existing = await db
      .select()
      .from(verificationIngestState)
      .where(eq(verificationIngestState.tenantId, ctx.tenantId))
      .limit(1);
    const row = firstOrUndefined(existing);
    if (row) return row;
    const inserted = await db
      .insert(verificationIngestState)
      .values({
        tenantId: ctx.tenantId,
        pollDealDateWatermark: defaultDealWatermark(),
      })
      .returning();
    return firstOrThrow(inserted, 'verification_ingest_state insert returned no row');
  },

  async saveRun(
    ctx: TenantContext,
    input: {
      watermark: string;
      created: number;
      skipped: number;
      failed: number;
    },
  ): Promise<void> {
    await db
      .update(verificationIngestState)
      .set({
        pollDealDateWatermark: input.watermark,
        lastRunAt: new Date(),
        lastCreated: input.created,
        lastSkipped: input.skipped,
        lastFailed: input.failed,
        updatedAt: new Date(),
      })
      .where(eq(verificationIngestState.tenantId, ctx.tenantId));
  },
};
