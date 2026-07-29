import { createId } from '@paralleldrive/cuid2';
import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import type { Audience } from '../../types/tenantContext.js';

export type BulkChangeOperation = 'insert' | 'update' | 'delete';
export type BulkChangeSnapshot = Record<string, unknown>;

/**
 * Database-level before/after journal for the restricted Data Loader connection.
 *
 * Unlike audit_log, rows are written by an AFTER trigger because NocoDB writes directly to
 * Postgres and never reaches the application audit pipeline. The table is append-only to the
 * loader role; only the application role may stamp revert attribution.
 */
export const bulkChangeLog = pgTable(
  'bulk_change_log',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `bcl_${createId()}`),
    tenantId: text('tenant_id').notNull(),
    audience: text('audience').$type<Audience>(),
    batchId: text('batch_id').notNull(),
    tableName: text('table_name').notNull(),
    rowPk: text('row_pk').notNull(),
    op: text('op').$type<BulkChangeOperation>().notNull(),
    before: jsonb('before').$type<BulkChangeSnapshot>(),
    after: jsonb('after').$type<BulkChangeSnapshot>(),
    dbUser: text('db_user').notNull(),
    revertedAt: timestamp('reverted_at', { withTimezone: true }),
    revertedBy: text('reverted_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    batchIdx: index('bulk_change_log_batch_idx').on(table.batchId),
    rowIdx: index('bulk_change_log_table_row_idx').on(table.tableName, table.rowPk),
    createdIdx: index('bulk_change_log_created_idx').on(table.createdAt),
    tenantBatchIdx: index('bulk_change_log_tenant_batch_idx').on(
      table.tenantId,
      table.batchId,
    ),
    opCheck: check(
      'bulk_change_log_op_check',
      sql`${table.op} IN ('insert', 'update', 'delete')`,
    ),
  }),
);

export type BulkChangeEntry = typeof bulkChangeLog.$inferSelect;
