import { createId } from '@paralleldrive/cuid2';
import { index, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import type { Audience } from '../../types/tenantContext.js';

/**
 * Per-conversation shared working state for Horizon AI supervisor↔worker handoffs.
 * Payload is Zod-validated at the module layer; DB stores opaque JSON.
 */
export const agentBlackboards = pgTable(
  'agent_blackboards',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    tenantId: text('tenant_id').notNull(),
    audience: text('audience').$type<Audience>().notNull(),
    conversationId: text('conversation_id').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantConvUniq: uniqueIndex('agent_blackboards_tenant_conv_uidx').on(
      table.tenantId,
      table.conversationId,
    ),
    tenantIdx: index('agent_blackboards_tenant_idx').on(table.tenantId),
  }),
);

export type AgentBlackboard = typeof agentBlackboards.$inferSelect;
export type NewAgentBlackboard = typeof agentBlackboards.$inferInsert;
