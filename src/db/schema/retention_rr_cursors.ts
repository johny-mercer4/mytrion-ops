/**
 * Tenant-scoped RoundRobin cursor for Phase 2 Retention CS assignment.
 */
import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const retentionRrCursors = pgTable('retention_rr_cursors', {
  tenantId: text('tenant_id').primaryKey(),
  lastZohoUserId: text('last_zoho_user_id'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type RetentionRrCursor = typeof retentionRrCursors.$inferSelect;
