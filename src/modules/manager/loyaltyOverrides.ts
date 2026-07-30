import type {
  LoyaltyClientOverride,
  LoyaltyEnterpriseMode,
  LoyaltyRewardId,
} from '../../db/schema/index.js';
import { loyaltyClientOverrideRepo } from '../../repos/loyaltyClientOverrideRepo.js';
import type { TenantContext } from '../../types/tenantContext.js';

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
  const rows = await loyaltyClientOverrideRepo.list(ctx);
  return new Map(rows.map((row) => [row.carrierId, loyaltyOverrideView(row)]));
}
