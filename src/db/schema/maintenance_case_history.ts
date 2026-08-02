import { createId } from '@paralleldrive/cuid2';
import { index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { maintenanceCases } from './maintenance_cases.js';

/**
 * maintenance_case_history — one row per create/update, mirroring the CRM's Timeline History
 * (who changed what, from what, to what). `changes` groups every field a single save touched
 * into one entry, matching how the CRM timeline visually groups simultaneous field updates
 * under one timestamp/actor, and needs exactly one insert per save rather than one per field.
 */
export interface MaintenanceHistoryChange {
  field: string;
  label: string;
  from: string | null;
  to: string | null;
}

export const maintenanceCaseHistory = pgTable(
  'maintenance_case_history',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `mch_${createId()}`),
    caseId: text('case_id')
      .notNull()
      .references(() => maintenanceCases.id, { onDelete: 'cascade' }),
    action: text('action').$type<'created' | 'updated'>().notNull(),
    changedByUserId: text('changed_by_user_id'),
    changedByName: text('changed_by_name'),
    changes: jsonb('changes').$type<MaintenanceHistoryChange[]>().notNull(),
    changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    caseIdx: index('maintenance_case_history_case_idx').on(table.caseId, table.changedAt),
  }),
);

export type MaintenanceCaseHistoryRow = typeof maintenanceCaseHistory.$inferSelect;
export type NewMaintenanceCaseHistoryRow = typeof maintenanceCaseHistory.$inferInsert;
