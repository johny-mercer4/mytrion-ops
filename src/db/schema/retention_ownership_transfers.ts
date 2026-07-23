/**
 * Append-only Zoho ownership transfer log for Retention.
 * Intentionally has NO FK to retention_cases — rows survive case hard-delete.
 */
import {
  bigint,
  bigserial,
  boolean,
  index,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

export const OWNERSHIP_TRANSFER_REASON = {
  retentionHandoff: 'retention_handoff',
  openPoolClaim: 'open_pool_claim',
  manualRevert: 'manual_revert',
  adminManual: 'admin_manual',
} as const;

export type OwnershipTransferReason =
  (typeof OWNERSHIP_TRANSFER_REASON)[keyof typeof OWNERSHIP_TRANSFER_REASON];

export const OWNERSHIP_TRANSFER_RESULT = {
  success: 'success',
  partial: 'partial',
  failed: 'failed',
} as const;

export type OwnershipTransferResultCode =
  (typeof OWNERSHIP_TRANSFER_RESULT)[keyof typeof OWNERSHIP_TRANSFER_RESULT];

export const retentionOwnershipTransfers = pgTable(
  'retention_ownership_transfers',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: text('tenant_id').notNull(),
    /** Nullable + no FK: log must outlive case deletion. */
    retentionCaseId: bigint('retention_case_id', { mode: 'number' }),
    carrierId: text('carrier_id'),
    companyName: text('company_name'),
    dealName: text('deal_name'),
    contactName: text('contact_name'),
    zohoDealId: text('zoho_deal_id'),
    zohoContactId: text('zoho_contact_id'),
    zohoAccountId: text('zoho_account_id'),
    reason: text('reason').$type<OwnershipTransferReason | string>().notNull(),
    result: text('result').$type<OwnershipTransferResultCode>().notNull(),
    fromOwnerZohoUserId: text('from_owner_zoho_user_id'),
    fromOwnerName: text('from_owner_name'),
    toOwnerZohoUserId: text('to_owner_zoho_user_id').notNull(),
    toOwnerName: text('to_owner_name'),
    actorZohoUserId: text('actor_zoho_user_id'),
    actorName: text('actor_name'),
    dealUpdated: boolean('deal_updated').notNull().default(false),
    contactUpdated: boolean('contact_updated').notNull().default(false),
    accountUpdated: boolean('account_updated').notNull().default(false),
    warnings: text('warnings'),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantCreatedIdx: index('retention_ownership_transfers_tenant_created_idx').on(
      table.tenantId,
      table.createdAt,
    ),
    dealIdx: index('retention_ownership_transfers_deal_idx').on(table.zohoDealId),
    caseIdx: index('retention_ownership_transfers_case_idx').on(table.retentionCaseId),
    carrierIdx: index('retention_ownership_transfers_carrier_idx').on(table.carrierId),
    fromOwnerIdx: index('retention_ownership_transfers_from_owner_idx').on(
      table.fromOwnerZohoUserId,
    ),
    toOwnerIdx: index('retention_ownership_transfers_to_owner_idx').on(table.toOwnerZohoUserId),
  }),
);

export type RetentionOwnershipTransfer = typeof retentionOwnershipTransfers.$inferSelect;
export type NewRetentionOwnershipTransfer = typeof retentionOwnershipTransfers.$inferInsert;
