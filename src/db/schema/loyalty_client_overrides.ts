import { createId } from '@paralleldrive/cuid2';
import { index, jsonb, numeric, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

export const LOYALTY_REWARD_IDS = [
  'transaction_fee_waiver',
  'credit_score_check',
  'money_code_limit',
  'monthly_fee_waiver',
  'ta_petro_rebate',
  'loves_rebate',
] as const;

export type LoyaltyRewardId = (typeof LOYALTY_REWARD_IDS)[number];
export type LoyaltyEnterpriseMode = 'normal_billing' | 'volume_target';

/**
 * Deliberate manager exceptions to the automatic loyalty program.
 *
 * A missing row means "use the normative tier result and its standard rewards". A present row can
 * supply an Enterprise operating mode / Gold target and, independently, an explicit reward set.
 * `enabledRewardIds = null` still means automatic rewards; an empty array means the manager
 * intentionally disabled every reward.
 */
export const loyaltyClientOverrides = pgTable(
  'loyalty_client_overrides',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `lco_${createId()}`),
    tenantId: text('tenant_id').notNull(),
    carrierId: text('carrier_id').notNull(),
    companyName: text('company_name').notNull(),
    enterpriseMode: text('enterprise_mode').$type<LoyaltyEnterpriseMode>(),
    enterpriseGoldTargetGallons: numeric('enterprise_gold_target_gallons', {
      precision: 14,
      scale: 2,
    }),
    enabledRewardIds: jsonb('enabled_reward_ids').$type<LoyaltyRewardId[] | null>(),
    note: text('note'),
    updatedBy: text('updated_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantCarrierUq: uniqueIndex('loyalty_client_overrides_tenant_carrier_uq').on(
      table.tenantId,
      table.carrierId,
    ),
    tenantIdx: index('loyalty_client_overrides_tenant_idx').on(table.tenantId, table.updatedAt),
  }),
);

export type LoyaltyClientOverride = typeof loyaltyClientOverrides.$inferSelect;
export type NewLoyaltyClientOverride = typeof loyaltyClientOverrides.$inferInsert;
