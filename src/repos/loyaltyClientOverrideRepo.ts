import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  loyaltyClientOverrides,
  type LoyaltyClientOverride,
  type LoyaltyEnterpriseMode,
  type LoyaltyRewardId,
} from '../db/schema/index.js';
import type { TenantContext } from '../types/tenantContext.js';

export interface SaveLoyaltyClientOverrideInput {
  carrierId: string;
  companyName: string;
  enterpriseMode: LoyaltyEnterpriseMode | null;
  enterpriseGoldTargetGallons: string | null;
  enabledRewardIds: LoyaltyRewardId[] | null;
  note: string | null;
  updatedBy: string;
}

function tenantScope(ctx: TenantContext) {
  return eq(loyaltyClientOverrides.tenantId, ctx.tenantId);
}

/** Tenant-isolated persistence for the Manager Loyalty override editor. */
export const loyaltyClientOverrideRepo = {
  async get(ctx: TenantContext, carrierId: string): Promise<LoyaltyClientOverride | undefined> {
    const rows = await db
      .select()
      .from(loyaltyClientOverrides)
      .where(and(tenantScope(ctx), eq(loyaltyClientOverrides.carrierId, carrierId)))
      .limit(1);
    return rows[0];
  },

  async list(ctx: TenantContext): Promise<LoyaltyClientOverride[]> {
    return db
      .select()
      .from(loyaltyClientOverrides)
      .where(tenantScope(ctx))
      .orderBy(desc(loyaltyClientOverrides.updatedAt));
  },

  async upsert(
    ctx: TenantContext,
    input: SaveLoyaltyClientOverrideInput,
  ): Promise<LoyaltyClientOverride> {
    const now = new Date();
    const mutable = {
      companyName: input.companyName,
      enterpriseMode: input.enterpriseMode,
      enterpriseGoldTargetGallons: input.enterpriseGoldTargetGallons,
      enabledRewardIds: input.enabledRewardIds,
      note: input.note,
      updatedBy: input.updatedBy,
      updatedAt: now,
    };
    const rows = await db
      .insert(loyaltyClientOverrides)
      .values({
        tenantId: ctx.tenantId,
        carrierId: input.carrierId,
        ...mutable,
      })
      .onConflictDoUpdate({
        target: [loyaltyClientOverrides.tenantId, loyaltyClientOverrides.carrierId],
        set: mutable,
      })
      .returning();
    const row = rows[0];
    if (!row) throw new Error('loyalty client override upsert returned no row');
    return row;
  },

  async remove(ctx: TenantContext, carrierId: string): Promise<boolean> {
    const rows = await db
      .delete(loyaltyClientOverrides)
      .where(and(tenantScope(ctx), eq(loyaltyClientOverrides.carrierId, carrierId)))
      .returning({ id: loyaltyClientOverrides.id });
    return rows.length > 0;
  },
};
