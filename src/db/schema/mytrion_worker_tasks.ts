import { createId } from '@paralleldrive/cuid2';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export type WorkerTaskPriority = 'low' | 'normal' | 'high' | 'urgent';
export type WorkerTaskStatus = 'open' | 'in_progress' | 'completed' | 'cancelled';
export type WorkerTaskSource = 'manager' | 'webhook';
export type WorkerTaskEventType =
  | 'created'
  | 'status_changed'
  | 'reassigned'
  | 'details_changed'
  | 'deadline_changed'
  | 'priority_changed'
  | 'commented'
  | 'completed'
  | 'cancelled'
  | 'reopened';

export const mytrionTaskTypes = pgTable(
  'mytrion_task_types',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `mtt_${createId()}`),
    tenantId: text('tenant_id').notNull(),
    code: text('code').notNull(),
    label: text('label').notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantCodeUk: uniqueIndex('mytrion_task_types_tenant_code_uk').on(
      table.tenantId,
      table.code,
    ),
  }),
);

export const mytrionWorkerTasks = pgTable(
  'mytrion_worker_tasks',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `mwt_${createId()}`),
    tenantId: text('tenant_id').notNull(),
    assigneeZohoUserId: text('assignee_zoho_user_id').notNull(),
    createdByUserId: text('created_by_user_id').notNull(),
    source: text('source').$type<WorkerTaskSource>().notNull(),
    webhookKeyId: text('webhook_key_id'),
    idempotencyKey: text('idempotency_key'),
    payloadHash: text('payload_hash'),
    externalId: text('external_id'),
    taskType: text('task_type').notNull(),
    subject: text('subject').notNull(),
    description: text('description'),
    content: jsonb('content').$type<Record<string, unknown>>(),
    priority: text('priority').$type<WorkerTaskPriority>().notNull().default('normal'),
    status: text('status').$type<WorkerTaskStatus>().notNull().default('open'),
    deadlineAt: timestamp('deadline_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    webhookIdempotencyUk: uniqueIndex('mytrion_worker_tasks_webhook_idempotency_uk').on(
      table.tenantId,
      table.webhookKeyId,
      table.idempotencyKey,
    ),
    assigneeStatusIdx: index('mytrion_worker_tasks_assignee_status_idx').on(
      table.tenantId,
      table.assigneeZohoUserId,
      table.status,
      table.deadlineAt,
    ),
    tenantCreatedIdx: index('mytrion_worker_tasks_tenant_created_idx').on(
      table.tenantId,
      table.createdAt,
    ),
  }),
);

export const mytrionWorkerTaskEvents = pgTable(
  'mytrion_worker_task_events',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `mwe_${createId()}`),
    tenantId: text('tenant_id').notNull(),
    taskId: text('task_id').notNull().references(() => mytrionWorkerTasks.id),
    eventType: text('event_type').$type<WorkerTaskEventType>().notNull(),
    actorUserId: text('actor_user_id').notNull(),
    fromStatus: text('from_status').$type<WorkerTaskStatus>(),
    toStatus: text('to_status').$type<WorkerTaskStatus>(),
    detail: jsonb('detail').$type<Record<string, unknown>>(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    taskTimeIdx: index('mytrion_worker_task_events_task_time_idx').on(
      table.tenantId,
      table.taskId,
      table.occurredAt,
    ),
  }),
);

export type MytrionTaskType = typeof mytrionTaskTypes.$inferSelect;
export type MytrionWorkerTask = typeof mytrionWorkerTasks.$inferSelect;
export type NewMytrionWorkerTask = typeof mytrionWorkerTasks.$inferInsert;
export type MytrionWorkerTaskEvent = typeof mytrionWorkerTaskEvents.$inferSelect;
