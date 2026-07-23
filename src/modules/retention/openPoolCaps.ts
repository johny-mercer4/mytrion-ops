/**
 * Sales Open Pool daily claim cap — max 2 assigns per agent per UTC day.
 */
import { and, eq, gte, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { CLAIM_REQUEST_STATUS, retentionClaimRequests } from '../../db/schema/index.js';
import { AppError } from '../../lib/errors.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { utcDayStart } from './csCaps.js';

export const OPEN_POOL_MAX_CLAIMS_PER_DAY = 2;

export async function countOpenPoolClaimsToday(
  ctx: TenantContext,
  zohoUserId: string,
  now: Date = new Date(),
): Promise<number> {
  const agent = zohoUserId.trim();
  if (!agent) return 0;
  const dayStart = utcDayStart(now);
  const rows = await db
    .select({
      n: sql<number>`count(*)::int`,
    })
    .from(retentionClaimRequests)
    .where(
      and(
        eq(retentionClaimRequests.tenantId, ctx.tenantId),
        eq(retentionClaimRequests.requesterZohoUserId, agent),
        eq(retentionClaimRequests.status, CLAIM_REQUEST_STATUS.approved),
        gte(retentionClaimRequests.resolvedAt, dayStart),
      ),
    );
  return Number(rows[0]?.n ?? 0);
}

export async function assertUnderOpenPoolDailyCap(
  ctx: TenantContext,
  zohoUserId: string,
  now: Date = new Date(),
): Promise<{ used: number; remaining: number }> {
  const used = await countOpenPoolClaimsToday(ctx, zohoUserId, now);
  if (used >= OPEN_POOL_MAX_CLAIMS_PER_DAY) {
    throw new AppError(
      `Daily Open Pool cap reached (${OPEN_POOL_MAX_CLAIMS_PER_DAY} claims/day). Try again tomorrow.`,
      {
        statusCode: 429,
        code: 'RETENTION_OPEN_POOL_DAILY_CAP',
        expose: true,
      },
    );
  }
  return { used, remaining: OPEN_POOL_MAX_CLAIMS_PER_DAY - used };
}

export async function getOpenPoolDailyQuota(
  ctx: TenantContext,
  zohoUserId: string,
  now: Date = new Date(),
): Promise<{ used: number; max: number; remaining: number }> {
  const used = await countOpenPoolClaimsToday(ctx, zohoUserId, now);
  return {
    used,
    max: OPEN_POOL_MAX_CLAIMS_PER_DAY,
    remaining: Math.max(0, OPEN_POOL_MAX_CLAIMS_PER_DAY - used),
  };
}
