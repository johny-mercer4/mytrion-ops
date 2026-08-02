import { createId } from '@paralleldrive/cuid2';
import { boolean, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

/** Resolution / first-response targets in hours, keyed by ticket priority. */
export type SlaHoursByPriority = Record<string, number>;

/**
 * One settings row per tenant — the comms control centre, mirroring hr_leave_settings.
 *
 * The SLA defaults reproduce what the Sales widget computes in the browser today
 * (4h high/critical, 72h low, 24h otherwise), so moving SLA server-side is behaviour-identical on
 * day one and then editable without a frontend deploy.
 */
export const mytrionCommsSettings = pgTable(
  'mytrion_comms_settings',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `mcs_${createId()}`),
    tenantId: text('tenant_id').notNull(),
    slaHoursByPriority: jsonb('sla_hours_by_priority')
      .$type<SlaHoursByPriority>()
      .notNull()
      .default({ low: 72, medium: 24, high: 4, critical: 4 }),
    firstResponseHoursByPriority: jsonb('first_response_hours_by_priority')
      .$type<SlaHoursByPriority>()
      .notNull()
      .default({ low: 24, medium: 8, high: 2, critical: 1 }),
    /**
     * ESCALATION LEVEL 4 is NOT configured here. It is the `c-level` pool in
     * mytrion_department_agents, because level 4 is more than one person — CEO and COO — and an
     * escalating manager picks which. A single column here would have been a second source of truth
     * for the same question, which is the pattern this whole design avoids. Level 4 is unreachable
     * (an escalation stops at the manager level) when that pool is empty.
     */
    /** Phase gate for 1:1 chat, flippable in the DB with no redeploy. */
    dmEnabled: boolean('dm_enabled').notNull().default(false),
    /**
     * Whether an admin may read other people's DMs at all. Off by design: internal 1:1 chat is the
     * one dataset where a blanket admin bypass is an HR exposure and operationally pointless — no
     * ticket is resolved by reading a colleague's messages. Turning it on still requires a dedicated
     * audited route.
     */
    dmAdminReadEnabled: boolean('dm_admin_read_enabled').notNull().default(false),
    timezone: text('timezone').notNull().default('Asia/Tashkent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantUk: uniqueIndex('mytrion_comms_settings_tenant_uk').on(table.tenantId),
  }),
);

export type MytrionCommsSettings = typeof mytrionCommsSettings.$inferSelect;
export type NewMytrionCommsSettings = typeof mytrionCommsSettings.$inferInsert;
