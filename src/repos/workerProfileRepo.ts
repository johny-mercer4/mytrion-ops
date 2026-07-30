import { and, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { workerProfiles, type WorkerProfile } from '../db/schema/index.js';
import type { TenantContext } from '../types/tenantContext.js';
import { firstOrUndefined } from './util.js';

/**
 * worker_profiles — tenant-scoped prefs keyed by Zoho CRM user id.
 * Avatar is a small data-URL; every query filters `tenant_id`.
 */
export const workerProfileRepo = {
  async getByZohoUserId(
    ctx: TenantContext,
    zohoUserId: string,
  ): Promise<WorkerProfile | undefined> {
    const id = zohoUserId.trim();
    if (!id) return undefined;
    const rows = await db
      .select()
      .from(workerProfiles)
      .where(and(eq(workerProfiles.tenantId, ctx.tenantId), eq(workerProfiles.zohoUserId, id)))
      .limit(1);
    return firstOrUndefined(rows);
  },

  async setAvatar(
    ctx: TenantContext,
    zohoUserId: string,
    avatarDataUrl: string | null,
  ): Promise<WorkerProfile> {
    const id = zohoUserId.trim();
    const existing = await this.getByZohoUserId(ctx, id);
    const now = new Date();
    if (existing) {
      const rows = await db
        .update(workerProfiles)
        .set({ avatarDataUrl, updatedAt: now })
        .where(and(eq(workerProfiles.tenantId, ctx.tenantId), eq(workerProfiles.id, existing.id)))
        .returning();
      const row = firstOrUndefined(rows);
      if (!row) throw new Error('worker_profiles update returned no row');
      return row;
    }
    const rows = await db
      .insert(workerProfiles)
      .values({
        tenantId: ctx.tenantId,
        zohoUserId: id,
        avatarDataUrl,
      })
      .returning();
    const row = firstOrUndefined(rows);
    if (!row) throw new Error('worker_profiles insert returned no row');
    return row;
  },
};
