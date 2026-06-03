import { createId } from '@paralleldrive/cuid2';
import { index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import type { Audience } from '../../types/tenantContext.js';

export const conversations = pgTable(
  'conversations',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    tenantId: text('tenant_id').notNull(),
    userId: text('user_id').notNull(),
    audience: text('audience').$type<Audience>().notNull(),
    title: text('title'),
    status: text('status').$type<'active' | 'archived'>().notNull().default('active'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantIdx: index('conversations_tenant_idx').on(table.tenantId),
    userIdx: index('conversations_user_idx').on(table.tenantId, table.userId),
  }),
);

export type Conversation = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;
