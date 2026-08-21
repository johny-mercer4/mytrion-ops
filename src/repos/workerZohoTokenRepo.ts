import { and, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { workerZohoTokens } from '../db/schema/index.js';
import { decryptSecret, encryptSecret } from '../lib/crypto.js';

function storedToken(refreshToken: string): string {
  return encryptSecret(refreshToken);
}

function usableToken(stored: string): string {
  // Compatibility for rows written before refresh-token encryption shipped. The next OAuth
  // consent replaces those rows with ciphertext; no broad data migration is needed.
  return stored.split(':').length === 3 ? decryptSecret(stored) : stored;
}

/**
 * Persist and retrieve per-user Zoho refresh tokens. Takes tenantId + zohoUserId directly
 * (not TenantContext) so it can be called from the login path before a session is issued.
 */
export const workerZohoTokenRepo = {
  /** Insert or replace a worker's Zoho refresh token. */
  async upsert(tenantId: string, zohoUserId: string, refreshToken: string): Promise<void> {
    const encryptedRefreshToken = storedToken(refreshToken);
    await db
      .insert(workerZohoTokens)
      .values({ tenantId, zohoUserId, refreshToken: encryptedRefreshToken })
      .onConflictDoUpdate({
        target: [workerZohoTokens.tenantId, workerZohoTokens.zohoUserId],
        set: { refreshToken: encryptedRefreshToken, updatedAt: new Date() },
      });
  },

  /** Return the stored refresh token, or null if none exists. */
  async find(tenantId: string, zohoUserId: string): Promise<string | null> {
    const rows = await db
      .select({ refreshToken: workerZohoTokens.refreshToken })
      .from(workerZohoTokens)
      .where(
        and(eq(workerZohoTokens.tenantId, tenantId), eq(workerZohoTokens.zohoUserId, zohoUserId)),
      )
      .limit(1);
    const stored = rows[0]?.refreshToken;
    return stored ? usableToken(stored) : null;
  },
};
