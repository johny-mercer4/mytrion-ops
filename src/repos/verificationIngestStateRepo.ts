import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { verificationIngestState, type VerificationIngestState } from '../db/schema/index.js';
import type { TenantContext } from '../types/tenantContext.js';
import { firstOrThrow, firstOrUndefined } from './util.js';

/** Fresh-only default: now, not a 30-day Application_Date lookback. */
export function defaultDealWatermark(now = new Date()): string {
  return now.toISOString().replace(/\.\d{3}Z$/, '+00:00');
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

  async pinWatermark(ctx: TenantContext, watermark: string): Promise<void> {
    await db
      .update(verificationIngestState)
      .set({
        pollDealDateWatermark: watermark,
        updatedAt: new Date(),
      })
      .where(eq(verificationIngestState.tenantId, ctx.tenantId));
  },

  /**
   * One-time cut: date-only cursors would replay historical Application_Date deals.
   * Persist `now` at enable/boot so the first cron does not move the floor again.
   */
  async pinLegacyToNow(ctx: TenantContext, now = new Date()): Promise<string> {
    const state = await this.getOrCreate(ctx);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(state.pollDealDateWatermark.trim())) {
      return state.pollDealDateWatermark;
    }
    const next = defaultDealWatermark(now);
    await this.pinWatermark(ctx, next);
    return next;
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
