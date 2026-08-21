/**
 * Collection desk — the WRITE side, which `collection.ts` does not have.
 *
 * The three finder-owned snapshots in `collection.ts` (cases, invoices, Array tradelines) are
 * read-only by construction: an upsert job owns every column and the desk may not touch them.
 * That left the module able to say what a case IS and nothing about what anyone has DONE, so
 * `Last touch`, the activity feed and the worklist had no source. These four tables are that
 * source, and they are OURS — nothing outside this app writes them and no Zoho sync reads them.
 *
 * Same global-operational keying as `collection_cases`: no `tenant_id` column, isolation enforced
 * in the repo through `canReadCollectionSnapshot`. Everything cascades off the case, so a case the
 * finder is ever deleted takes its desk history with it. In practice the finder never deletes —
 * it zeroes the money and leaves the row — so this is a guarantee, not a routine path.
 */
import { createId } from '@paralleldrive/cuid2';
import { sql } from 'drizzle-orm';
import {
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { collectionCases } from './collection.js';

/**
 * What a timeline entry IS. Deliberately a closed set rather than free text: the case record
 * groups the feed by these, and the worklist reads `contact` to compute last touch.
 */
export const COLLECTION_ACTIVITY_KINDS = [
  'contact',
  'promise',
  'plan',
  'payment',
  'stage',
  'agency',
  'note',
  'close',
] as const;
export type CollectionActivityKind = (typeof COLLECTION_ACTIVITY_KINDS)[number];

/** How a contact attempt was made. Null on every non-contact kind. */
export const COLLECTION_CONTACT_CHANNELS = ['call', 'email', 'sms', 'letter'] as const;
export type CollectionContactChannel = (typeof COLLECTION_CONTACT_CHANNELS)[number];

/**
 * How it went. `no_answer` and `voicemail` are separate because they mean different things to
 * the next collector: one is a number that rings out, the other is a number that answers.
 */
export const COLLECTION_CONTACT_OUTCOMES = [
  'reached',
  'no_answer',
  'voicemail',
  'wrong_number',
  'refused',
] as const;
export type CollectionContactOutcome = (typeof COLLECTION_CONTACT_OUTCOMES)[number];

export const COLLECTION_PROMISE_STATUSES = ['open', 'kept', 'broken', 'cancelled'] as const;
export type CollectionPromiseStatus = (typeof COLLECTION_PROMISE_STATUSES)[number];

export const COLLECTION_PLAN_STATUSES = ['active', 'completed', 'cancelled', 'broken'] as const;
export type CollectionPlanStatus = (typeof COLLECTION_PLAN_STATUSES)[number];

export const COLLECTION_PLAN_FREQUENCIES = ['weekly', 'fortnightly', 'monthly'] as const;
export type CollectionPlanFrequency = (typeof COLLECTION_PLAN_FREQUENCIES)[number];

export const COLLECTION_INSTALMENT_STATUSES = ['scheduled', 'paid', 'missed'] as const;
export type CollectionInstalmentStatus = (typeof COLLECTION_INSTALMENT_STATUSES)[number];

/**
 * One row per thing that happened on a case, newest-first in the UI.
 *
 * `occurred_at` is separate from `created_at` on purpose: a collector logging yesterday's call
 * this morning must be able to say when the call was, and the feed must order by the call.
 */
export const collectionActivity = pgTable(
  'collection_activity',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `cla_${createId()}`),
    caseId: text('case_id')
      .notNull()
      .references(() => collectionCases.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<CollectionActivityKind>().notNull(),
    channel: text('channel').$type<CollectionContactChannel>(),
    outcome: text('outcome').$type<CollectionContactOutcome>(),
    /** One line, rendered as the entry's heading. */
    summary: text('summary').notNull(),
    /** What was said. Free text, the thing the next collector actually reads. */
    note: text('note'),
    /** Who at the debtor was spoken to — not a user of ours. */
    contactName: text('contact_name'),
    amount: numeric('amount'),
    actorUserId: text('actor_user_id'),
    actorName: text('actor_name'),
    /** Kind-specific extras (stage from/to, plan id, agency file period). Never queried on. */
    meta: jsonb('meta').$type<Record<string, unknown>>(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    caseIdx: index('collection_activity_case_idx').on(table.caseId, table.occurredAt),
    /** Drives `Last touch` on the list: newest contact per case, without scanning the feed. */
    contactIdx: index('collection_activity_contact_idx').on(table.kind, table.caseId, table.occurredAt),
  }),
);

/**
 * A dated commitment to pay. NOT a case status — a case on a payment plan can also carry an
 * open promise for this month's instalment, and the two mean different things.
 */
export const collectionPromises = pgTable(
  'collection_promises',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `clp_${createId()}`),
    caseId: text('case_id')
      .notNull()
      .references(() => collectionCases.id, { onDelete: 'cascade' }),
    amount: numeric('amount').notNull(),
    dueDate: date('due_date').notNull(),
    status: text('status').$type<CollectionPromiseStatus>().notNull().default('open'),
    note: text('note'),
    createdByUserId: text('created_by_user_id'),
    createdByName: text('created_by_name'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    caseIdx: index('collection_promises_case_idx').on(table.caseId, table.dueDate),
    /** The worklist asks "which promises are due or lapsed" across the whole book. */
    dueIdx: index('collection_promises_due_idx').on(table.status, table.dueDate),
  }),
);

/**
 * An instalment agreement. At most one `active` plan per case — enforced by a partial unique
 * index rather than by application code, because two live schedules on one debt is an accounting
 * question nobody can answer afterwards.
 */
export const collectionPaymentPlans = pgTable(
  'collection_payment_plans',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `cpp_${createId()}`),
    caseId: text('case_id')
      .notNull()
      .references(() => collectionCases.id, { onDelete: 'cascade' }),
    status: text('status').$type<CollectionPlanStatus>().notNull().default('active'),
    instalmentAmount: numeric('instalment_amount').notNull(),
    instalmentCount: integer('instalment_count').notNull(),
    frequency: text('frequency').$type<CollectionPlanFrequency>().notNull(),
    firstPaymentDate: date('first_payment_date').notNull(),
    note: text('note'),
    /** The plan this one replaced, so a revision chain is readable. */
    supersedesPlanId: text('supersedes_plan_id'),
    createdByUserId: text('created_by_user_id'),
    createdByName: text('created_by_name'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    caseIdx: index('collection_payment_plans_case_idx').on(table.caseId, table.createdAt),
    activeUk: uniqueIndex('collection_payment_plans_active_uk')
      .on(table.caseId)
      .where(sql`${table.status} = 'active'`),
  }),
);

/**
 * One row per scheduled payment. Materialised rather than derived: the case record shows which
 * instalments were paid and which were missed, and "missed" is a fact about a date that passed,
 * not something a formula over the plan can recover once the schedule is revised.
 */
export const collectionPlanInstalments = pgTable(
  'collection_plan_instalments',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `cpi_${createId()}`),
    planId: text('plan_id')
      .notNull()
      .references(() => collectionPaymentPlans.id, { onDelete: 'cascade' }),
    caseId: text('case_id')
      .notNull()
      .references(() => collectionCases.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    dueDate: date('due_date').notNull(),
    amount: numeric('amount').notNull(),
    status: text('status').$type<CollectionInstalmentStatus>().notNull().default('scheduled'),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    planSeqUk: uniqueIndex('collection_plan_instalments_plan_seq_uk').on(table.planId, table.seq),
    caseIdx: index('collection_plan_instalments_case_idx').on(table.caseId, table.dueDate),
    dueIdx: index('collection_plan_instalments_due_idx').on(table.status, table.dueDate),
  }),
);

export type CollectionActivityRow = typeof collectionActivity.$inferSelect;
export type NewCollectionActivityRow = typeof collectionActivity.$inferInsert;
export type CollectionPromiseRow = typeof collectionPromises.$inferSelect;
export type NewCollectionPromiseRow = typeof collectionPromises.$inferInsert;
export type CollectionPaymentPlanRow = typeof collectionPaymentPlans.$inferSelect;
export type NewCollectionPaymentPlanRow = typeof collectionPaymentPlans.$inferInsert;
export type CollectionPlanInstalmentRow = typeof collectionPlanInstalments.$inferSelect;
export type NewCollectionPlanInstalmentRow = typeof collectionPlanInstalments.$inferInsert;
