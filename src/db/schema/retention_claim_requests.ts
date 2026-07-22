/**
 * Open Pool claim audit — instant claims land as `approved`;
 * unclaimed pool exits (3BD → Retention/CITI) land as `expired`.
 * Legacy `requested` may exist briefly during migrate backfill.
 */
import {
  bigint,
  bigserial,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { retentionCases } from './retention_cases.js';

export const CLAIM_REQUEST_STATUS = {
  requested: 'requested',
  rejected: 'rejected',
  approved: 'approved',
  expired: 'expired',
} as const;

export type ClaimRequestStatus =
  (typeof CLAIM_REQUEST_STATUS)[keyof typeof CLAIM_REQUEST_STATUS];

export const retentionClaimRequests = pgTable(
  'retention_claim_requests',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: text('tenant_id').notNull(),
    retentionCaseId: bigint('retention_case_id', { mode: 'number' })
      .notNull()
      .references(() => retentionCases.id, { onDelete: 'cascade' }),
    carrierId: text('carrier_id').notNull(),
    zohoDealId: text('zoho_deal_id'),
    requesterZohoUserId: text('requester_zoho_user_id').notNull(),
    requesterName: text('requester_name'),
    /** Former pool owner when claim was taken (Sales agent who lost the deal). */
    previousOwnerZohoUserId: text('previous_owner_zoho_user_id'),
    previousOwnerName: text('previous_owner_name'),
    reason: text('reason').notNull(),
    status: text('status').notNull().default('requested'),
    /** e.g. 3bd_unclaimed_to_retention | max_agents_to_citi | migrate_zoho_failed */
    outcomeNote: text('outcome_note'),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedByZohoUserId: text('resolved_by_zoho_user_id'),
  },
  (table) => ({
    tenantStatusIdx: index('retention_claim_requests_tenant_status_idx').on(
      table.tenantId,
      table.status,
    ),
    caseIdx: index('retention_claim_requests_case_idx').on(table.retentionCaseId),
    tenantRequestedAtIdx: index('retention_claim_requests_tenant_requested_at_idx').on(
      table.tenantId,
      table.requestedAt,
    ),
    /** One open (requested) claim per case — legacy pending only. */
    oneOpenPerCase: uniqueIndex('retention_claim_requests_one_open_per_case')
      .on(table.retentionCaseId)
      .where(sql`${table.status} = 'requested'`),
  }),
);

export type RetentionClaimRequest = typeof retentionClaimRequests.$inferSelect;
export type NewRetentionClaimRequest = typeof retentionClaimRequests.$inferInsert;
