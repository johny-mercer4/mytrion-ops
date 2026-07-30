import { createId } from '@paralleldrive/cuid2';
import { index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import type { HrLeaveRequestStatus } from './hr_leave_requests.js';

export type HrLeaveAction =
  | 'submitted'
  | 'lead_approved'
  | 'hr_approved'
  | 'rejected'
  | 'cancelled';

/** Append-only workflow journal. The general audit log receives a matching security event. */
export const hrLeaveRequestActions = pgTable(
  'hr_leave_request_actions',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `hlra_${createId()}`),
    tenantId: text('tenant_id').notNull(),
    requestId: text('request_id').notNull(),
    action: text('action').$type<HrLeaveAction>().notNull(),
    actorEmployeeId: text('actor_employee_id'),
    actorUserId: text('actor_user_id').notNull(),
    fromStatus: text('from_status').$type<HrLeaveRequestStatus>(),
    toStatus: text('to_status').$type<HrLeaveRequestStatus>().notNull(),
    comment: text('comment'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantRequestIdx: index('hr_leave_request_actions_tenant_request_idx').on(
      table.tenantId,
      table.requestId,
      table.createdAt,
    ),
  }),
);

export type HrLeaveRequestAction = typeof hrLeaveRequestActions.$inferSelect;
export type NewHrLeaveRequestAction = typeof hrLeaveRequestActions.$inferInsert;
