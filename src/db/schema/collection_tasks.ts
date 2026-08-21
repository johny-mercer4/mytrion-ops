import { createId } from '@paralleldrive/cuid2';
import { date, index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { collectionCases } from './collection.js';

/**
 * collection_tasks — the follow-ups Zoho kept in its Tasks related list.
 *
 * NOT the same thing as the Today worklist, and not another `collection_activity` kind. The
 * worklist is derived: it decides which cases need attention using policy and the case's own
 * state, and nobody edits it. A task is the opposite — a collector says "call this one back on
 * Thursday", and that reminder is mutable state that opens, gets rescheduled, and closes.
 * `collection_activity` is an append-only log and the wrong home for something you edit.
 *
 * Cascades off the case for the same reason the rest of the desk model does: a follow-up on a
 * debt that no longer exists is not worth orphaning.
 */
export const COLLECTION_TASK_STATUSES = ['open', 'done', 'cancelled'] as const;
export type CollectionTaskStatus = (typeof COLLECTION_TASK_STATUSES)[number];

export const COLLECTION_TASK_PRIORITIES = ['low', 'normal', 'high'] as const;
export type CollectionTaskPriority = (typeof COLLECTION_TASK_PRIORITIES)[number];

export const collectionTasks = pgTable(
  'collection_tasks',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `ctk_${createId()}`),
    caseId: text('case_id')
      .notNull()
      .references(() => collectionCases.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    note: text('note'),
    dueDate: date('due_date').notNull(),
    status: text('status').$type<CollectionTaskStatus>().notNull(),
    priority: text('priority').$type<CollectionTaskPriority>().notNull(),
    assigneeUserId: text('assignee_user_id'),
    assigneeName: text('assignee_name'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    completedById: text('completed_by_id'),
    createdById: text('created_by_id'),
    createdByName: text('created_by_name'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    caseIdx: index('collection_tasks_case_idx').on(table.caseId, table.dueDate),
    assigneeIdx: index('collection_tasks_assignee_idx').on(table.assigneeUserId, table.status),
  }),
);

export type CollectionTask = typeof collectionTasks.$inferSelect;
export type NewCollectionTask = typeof collectionTasks.$inferInsert;
