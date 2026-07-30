import type {
  LoyaltyClientOverride,
  LoyaltyEnterpriseMode,
  LoyaltyRewardId,
} from '../../db/schema/index.js';
import { loyaltyClientOverrideRepo } from '../../repos/loyaltyClientOverrideRepo.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { logger } from '../../lib/logger.js';

export interface LoyaltyOverrideView {
  carrierId: string;
  enterpriseMode: LoyaltyEnterpriseMode | null;
  enterpriseGoldTargetGallons: number | null;
  enabledRewardIds: LoyaltyRewardId[] | null;
  note: string | null;
  updatedBy: string;
  updatedAt: string;
}

export function loyaltyOverrideView(row: LoyaltyClientOverride): LoyaltyOverrideView {
  return {
    carrierId: row.carrierId,
    enterpriseMode: row.enterpriseMode,
    enterpriseGoldTargetGallons:
      row.enterpriseGoldTargetGallons === null ? null : Number(row.enterpriseGoldTargetGallons),
    enabledRewardIds: row.enabledRewardIds,
    note: row.note,
    updatedBy: row.updatedBy,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function loyaltyOverrides(
  ctx: TenantContext,
): Promise<Map<string, LoyaltyOverrideView>> {
  try {
    const rows = await loyaltyClientOverrideRepo.list(ctx);
    return new Map(rows.map((row) => [row.carrierId, loyaltyOverrideView(row)]));
  } catch (error) {
    /**
     * Manual exceptions are optional decoration over the normative automatic calculation. A pending
     * migration or short app-DB interruption must not blank the entire DWH roster; degrade to automatic
     * rewards and log the exact failure. Writes remain fail-closed in the manager route.
     */
    logger.warn(
      {
        err: error instanceof Error ? error.message : String(error),
        tenantId: ctx.tenantId,
      },
      'loyalty overrides unavailable — serving automatic program',
    );
    return new Map();
  }
}
