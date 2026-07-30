import { createId } from '@paralleldrive/cuid2';
import {
  bigint,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export type SupportBotOperationStatus =
  | 'processing'
  | 'succeeded'
  | 'failed_safe'
  | 'unknown';

export type SupportBotOperationPhase =
  | 'claimed'
  | 'external_started'
  | 'external_completed'
  | 'delivery_queued'
  | 'completed';

/**
 * Authoritative, tenant-scoped fencing state. Values come from one global Postgres sequence:
 * global monotonicity implies monotonicity for every individual session without maintaining a
 * separate counter per row.
 */
export const supportBotSessionFences = pgTable(
  'support_bot_session_fences',
  {
    tenantId: text('tenant_id').notNull(),
    /** SHA-256 of the environment/bot/chat/user session identity; contains no raw Telegram PII. */
    sessionKeyHash: text('session_key_hash').notNull(),
    currentFence: bigint('current_fence', { mode: 'number' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantSessionUq: uniqueIndex('support_bot_session_fences_tenant_session_uq').on(
      table.tenantId,
      table.sessionKeyHash,
    ),
  }),
);

/**
 * One row per support-bot write intent. Results are deliberately sanitized: money-code values,
 * full PANs, credentials, and private DM bodies must never be persisted here.
 */
export const supportBotOperations = pgTable(
  'support_bot_operations',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `sbo_${createId()}`),
    tenantId: text('tenant_id').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    operationType: text('operation_type').notNull(),
    requestHash: text('request_hash').notNull(),
    turnId: text('turn_id').notNull(),
    writeOccurrence: integer('write_occurrence').notNull(),
    sessionKeyHash: text('session_key_hash').notNull(),
    fencingToken: bigint('fencing_token', { mode: 'number' }).notNull(),
    actorTelegramUserId: text('actor_telegram_user_id').notNull(),
    carrierId: text('carrier_id').notNull(),
    status: text('status')
      .$type<SupportBotOperationStatus>()
      .notNull()
      .default('processing'),
    phase: text('phase')
      .$type<SupportBotOperationPhase>()
      .notNull()
      .default('claimed'),
    sanitizedResponse: jsonb('sanitized_response').$type<Record<string, unknown>>(),
    errorCode: text('error_code'),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }).notNull(),
    attempts: integer('attempts').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => ({
    tenantIdempotencyUq: uniqueIndex('support_bot_operations_tenant_idempotency_uq').on(
      table.tenantId,
      table.idempotencyKey,
    ),
    tenantTurnOccurrenceUq: uniqueIndex(
      'support_bot_operations_tenant_turn_occurrence_uq',
    ).on(
      table.tenantId,
      table.turnId,
      table.writeOccurrence,
    ),
    tenantSessionIdx: index('support_bot_operations_tenant_session_idx').on(
      table.tenantId,
      table.sessionKeyHash,
      table.createdAt,
    ),
    statusLeaseIdx: index('support_bot_operations_status_lease_idx').on(
      table.status,
      table.leaseExpiresAt,
    ),
  }),
);

export type SupportBotOperation = typeof supportBotOperations.$inferSelect;
export type NewSupportBotOperation = typeof supportBotOperations.$inferInsert;
export type SupportBotSessionFence = typeof supportBotSessionFences.$inferSelect;
