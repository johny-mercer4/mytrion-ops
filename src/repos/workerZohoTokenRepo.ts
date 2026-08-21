import { and, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { workerZohoTokens } from '../db/schema/index.js';

/**
 * Persist and retrieve per-user Zoho refresh tokens. Takes tenantId + zohoUserId directly
 * (not TenantContext) so it can be called from the login path before a session is issued.
 */
export const workerZohoTokenRepo = {
  /** Insert or replace a worker's Zoho refresh token. */
  async upsert(tenantId: string, zohoUserId: string, refreshToken: string): Promise<void> {
    await db
      .insert(workerZohoTokens)
      .values({ tenantId, zohoUserId, refreshToken })
      .onConflictDoUpdate({
        target: [workerZohoTokens.tenantId, workerZohoTokens.zohoUserId],
        set: { refreshToken, updatedAt: new Date() },
      });
  },

  /** Return the stored refresh token, or null if none exists. */
  async find(tenantId: string, zohoUserId: string): Promise<string | null> {
    const rows = await db
      .select({ refreshToken: workerZohoTokens.refreshToken })
      .from(workerZohoTokens)
      .where(
        and(
          eq(workerZohoTokens.tenantId, tenantId),
          eq(workerZohoTokens.zohoUserId, zohoUserId),
        ),
      )
      .limit(1);
    return rows[0]?.refreshToken ?? null;
  },
};
