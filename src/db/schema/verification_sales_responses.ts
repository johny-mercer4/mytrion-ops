import { createId } from '@paralleldrive/cuid2';
import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

/**
 * Sales answers to action requests emitted by the read-only Verification platform. The response is
 * persisted here after it is sent to the owning Zoho Deal, giving Mytrion an idempotency key and an
 * audit-friendly history without ever writing to credit_platform.
 */
export const verificationSalesResponses = pgTable(
  'verification_sales_responses',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `vsr_${createId()}`),
    tenantId: text('tenant_id').notNull(),
    requestId: text('request_id').notNull(),
    dealId: text('deal_id').notNull(),
    externalEventId: text('external_event_id').notNull(),
    ownerZohoUserId: text('owner_zoho_user_id').notNull(),
    responseValues: jsonb('response_values').$type<Record<string, string>>().notNull().default({}),
    note: text('note'),
    attachmentName: text('attachment_name'),
    attachmentContentType: text('attachment_content_type'),
    attachmentSizeBytes: integer('attachment_size_bytes'),
    zohoNoteId: text('zoho_note_id'),
    syncWarning: text('sync_warning'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantEventUq: uniqueIndex('verification_sales_responses_tenant_event_uq').on(
      table.tenantId,
      table.requestId,
      table.externalEventId,
    ),
    tenantRequestIdx: index('verification_sales_responses_tenant_request_idx').on(
      table.tenantId,
      table.requestId,
      table.createdAt,
    ),
  }),
);

export type VerificationSalesResponse = typeof verificationSalesResponses.$inferSelect;
