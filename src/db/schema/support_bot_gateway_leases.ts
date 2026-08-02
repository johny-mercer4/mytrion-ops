import { createId } from '@paralleldrive/cuid2';
import { index, integer, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

// NOTE: no DB foreign keys by design; no sibling value imports (drizzle-kit loads standalone).

/** One active Telegram long-poll consumer per tenant + bot identity, with standby takeover. */
export const supportBotGatewayLeases = pgTable(
  'support_bot_gateway_leases',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `sbgl_${createId()}`),
    tenantId: text('tenant_id').notNull(),
    botIdentity: text('bot_identity').notNull(),
    holderId: text('holder_id').notNull(),
    fencingToken: integer('fencing_token').notNull().default(1),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    identityUq: uniqueIndex('support_bot_gateway_leases_identity_uq').on(
      table.tenantId,
      table.botIdentity,
    ),
    expiryIdx: index('support_bot_gateway_leases_expiry_idx').on(table.expiresAt),
  }),
);

export type SupportBotGatewayLease = typeof supportBotGatewayLeases.$inferSelect;
