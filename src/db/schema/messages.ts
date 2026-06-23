import { createId } from '@paralleldrive/cuid2';
import { index, integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/** A single conversation turn. Mirrors the OpenAI chat message shape. */
export const messages = pgTable(
  'messages',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `msg_${createId()}`),
    tenantId: text('tenant_id').notNull(),
    conversationId: text('conversation_id').notNull(),
    role: text('role').$type<'system' | 'user' | 'assistant' | 'tool'>().notNull(),
    content: text('content').notNull().default(''),
    /** For assistant messages that requested tools: the OpenAI tool_calls array. */
    toolCalls: jsonb('tool_calls').$type<unknown>(),
    /** For tool messages: the id of the tool call this responds to. */
    toolCallId: text('tool_call_id'),
    /** For tool messages: the tool name. */
    name: text('name'),
    model: text('model'),
    promptTokens: integer('prompt_tokens'),
    completionTokens: integer('completion_tokens'),
    // --- Widget transcript metadata (set on user/assistant turns from the Zoho widget) ---
    /** department_scope sent for this turn (string or string[]). */
    departmentScope: jsonb('department_scope').$type<string | string[]>(),
    /** Grounded-passage count for the answer (assistant turns). */
    ragPassages: integer('rag_passages'),
    /** Tool calls used to produce the answer (assistant turns). */
    tools: jsonb('tools').$type<Array<{ name: string; status: string }>>(),
    /** Set if the turn errored. */
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    conversationIdx: index('messages_conversation_idx').on(table.conversationId, table.createdAt),
    tenantIdx: index('messages_tenant_idx').on(table.tenantId),
  }),
);

export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
