import { createId } from '@paralleldrive/cuid2';
import { boolean, index, integer, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

/** What an agent has declared about taking new work. Distinct from whether a socket is alive. */
export type AgentAvailability = 'available' | 'away' | 'do_not_assign';

/**
 * Socket-liveness LEASES, one row per (tenant, agent, web instance).
 *
 * Presence lives in Postgres rather than in the realtime hub's in-process Maps because ticket
 * round-robin has to answer "who is online right now" in SQL, inside the same transaction as the
 * ticket insert — otherwise two concurrent creates pick the same agent. It is also the reason
 * assignment stays correct on any number of web replicas without the pg NOTIFY bridge: each
 * instance writes its own lease, and the eligibility query reads all of them.
 *
 * Why PER-INSTANCE and not one row per agent: with N replicas one agent can hold sockets on two
 * instances. A single shared `socket_count` cannot be safely decremented by either (both would
 * race to zero), and a crashed instance would pin it above zero forever. Per-instance leases are
 * the only shape that is both multi-replica-correct and self-healing — a dead instance's rows
 * simply age out. Cost: one extra column in the natural key.
 *
 * Rows are ephemeral state, not history: they are deleted on graceful shutdown and swept at boot.
 * Never treat a row's existence as authorization for anything.
 */
export const mytrionAgentPresence = pgTable(
  'mytrion_agent_presence',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `map_${createId()}`),
    tenantId: text('tenant_id').notNull(),
    /** Zoho CRM user id (bare, no `zoho:` prefix) — the canonical actor key across comms. */
    zohoUserId: text('zoho_user_id').notNull(),
    /** Identifies the web process holding these sockets, so a restart invalidates only its own rows. */
    instanceId: text('instance_id').notNull(),
    /** Open sockets this agent holds ON THIS INSTANCE. Zero means connected-then-gone, not absent. */
    socketCount: integer('socket_count').notNull().default(0),
    connectedAt: timestamp('connected_at', { withTimezone: true }),
    /**
     * Refreshed by the heartbeat sweep. `socket_count > 0 AND last_seen_at > now() - PRESENCE_STALE`
     * is the online predicate; the staleness window is what makes a hard crash self-heal.
     */
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    /**
     * DIAGNOSTIC ONLY — a CSV snapshot of the session's departments at connect time, so an
     * ops view can answer "which queues have someone online" without a join. It is a stale copy
     * of a grant and MUST NOT be used as an ACL or as assignment eligibility; the authoritative
     * sources are mytrionAccessService for access and the department agent pool for eligibility.
     */
    departmentsSnapshot: text('departments_snapshot'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    /** The upsert target for the batched heartbeat flush. */
    leaseUk: uniqueIndex('mytrion_agent_presence_lease_uk').on(
      table.tenantId,
      table.zohoUserId,
      table.instanceId,
    ),
    /** Eligibility join: presence for a given agent, across instances. */
    agentIdx: index('mytrion_agent_presence_agent_idx').on(table.tenantId, table.zohoUserId),
    /** Boot sweep + staleness reaping. */
    staleIdx: index('mytrion_agent_presence_stale_idx').on(table.tenantId, table.lastSeenAt),
  }),
);

/**
 * The agent's own declared availability — durable, one row per agent, survives reconnect,
 * process restart and closing the browser.
 *
 * Eligibility for a new ticket is `socketAlive AND availability = 'available'`. Either half alone
 * is wrong: socket-only assigns work to a tab left open at lunch; declaration-only assigns work
 * to someone who set 'available' yesterday and shut the laptop. Requiring both makes the two
 * failure modes cancel, and matches call-center "ready" semantics.
 *
 * A disconnect must NOT flip this column. `socket_count` dropping already fails the liveness
 * half, and auto-flipping would let flaky wifi silently mark an agent away with no way to notice.
 * `auto_away` is the separate, explicit signal for "the server parked you" — the client displays
 * it and the agent opts back in; it must never silently self-heal to available.
 */
export const mytrionAgentAvailability = pgTable(
  'mytrion_agent_availability',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `maa_${createId()}`),
    tenantId: text('tenant_id').notNull(),
    zohoUserId: text('zoho_user_id').notNull(),
    availability: text('availability').$type<AgentAvailability>().notNull().default('available'),
    /** Free text the agent set alongside 'away' (e.g. "lunch until 14:00"). Never parsed. */
    availabilityNote: text('availability_note'),
    /** True when the SERVER parked them (socket died / idle window). Cleared only by the agent. */
    autoAway: boolean('auto_away').notNull().default(false),
    /** Why they were parked, so the UI can say "you went offline at 14:02" rather than guess. */
    autoAwayReason: text('auto_away_reason'),
    changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    agentUk: uniqueIndex('mytrion_agent_availability_agent_uk').on(
      table.tenantId,
      table.zohoUserId,
    ),
  }),
);

export type MytrionAgentPresence = typeof mytrionAgentPresence.$inferSelect;
export type NewMytrionAgentPresence = typeof mytrionAgentPresence.$inferInsert;
export type MytrionAgentAvailability = typeof mytrionAgentAvailability.$inferSelect;
export type NewMytrionAgentAvailability = typeof mytrionAgentAvailability.$inferInsert;
