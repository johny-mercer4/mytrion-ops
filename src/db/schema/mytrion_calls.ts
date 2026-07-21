import { createId } from '@paralleldrive/cuid2';
import { index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

// NOTE: no DB foreign keys by design — isolation + integrity live in the repo layer
// (see CLAUDE.md), so each schema file loads standalone under drizzle-kit.

/** Was the call answered? Derived from the RingCentral call-end event (no explicit flag exists). */
export type MytrionCallStatus = 'picked_up' | 'missed';

/** Which record the call was placed against — the mapping key back to the source record. */
export type MytrionCallSourceType = 'lead' | 'deal' | 'retention_case';

/**
 * mytrion_calls — our own call log, independent of RingCentral's history. One row per finished
 * OUTBOUND, agent-initiated call, written from the /ringcentral/call-events handler. Lets us map
 * a call to the lead/deal/retention case it was placed against (via the dial context that tags the
 * click-to-dial) and report on agent call activity without depending on the RC account.
 */
export const mytrionCalls = pgTable(
  'mytrion_calls',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `mc_${createId()}`),
    tenantId: text('tenant_id').notNull(),
    /** Zoho user id of the agent who placed the call (the acted-as agent under admin View-as). */
    callerZohoUserId: text('caller_zoho_user_id').notNull(),
    /** The number dialed (callee), as reported by RingCentral (not re-normalized). */
    phoneNumber: text('phone_number'),
    /** When the call started (RC startTime when present, else row insert time). */
    callTime: timestamp('call_time', { withTimezone: true }).notNull().defaultNow(),
    /** Talk duration in whole seconds (0 when never connected). */
    durationSeconds: integer('duration_seconds').notNull().default(0),
    callStatus: text('call_status').$type<MytrionCallStatus>().notNull(),
    sourceType: text('source_type').$type<MytrionCallSourceType>().notNull(),
    /** The lead / deal / retention_case id the call maps to (null if the source id was missing). */
    sourceId: text('source_id'),
    /** RingCentral session id — lets us dedupe / cross-reference the RC record. */
    sessionId: text('session_id'),
    /** Always 'Outbound' today (only agent-initiated outbound calls are logged). */
    direction: text('direction'),
    /** Raw RingCentral result string (e.g. 'Call connected', 'No Answer', 'Voicemail'). */
    result: text('result'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    callerIdx: index('mytrion_calls_tenant_caller_idx').on(
      table.tenantId,
      table.callerZohoUserId,
      table.createdAt,
    ),
    sourceIdx: index('mytrion_calls_tenant_source_idx').on(
      table.tenantId,
      table.sourceType,
      table.sourceId,
    ),
  }),
);

export type MytrionCall = typeof mytrionCalls.$inferSelect;
export type NewMytrionCall = typeof mytrionCalls.$inferInsert;
