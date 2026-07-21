/**
 * Open Pool claim requests — durable CS approval queue.
 * Case Processing lock still uses retention_cases.status = p1_pool_claim_pending.
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
    reason: text('reason').notNull(),
    status: text('status').notNull().default('requested'),
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
    /** One open (requested) claim per case. */
    oneOpenPerCase: uniqueIndex('retention_claim_requests_one_open_per_case')
      .on(table.retentionCaseId)
      .where(sql`${table.status} = 'requested'`),
  }),
);

export type RetentionClaimRequest = typeof retentionClaimRequests.$inferSelect;
export type NewRetentionClaimRequest = typeof retentionClaimRequests.$inferInsert;
