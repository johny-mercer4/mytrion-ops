import { createId } from '@paralleldrive/cuid2';
import { index, integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import type { Audience } from '../../types/tenantContext.js';

export const conversations = pgTable(
  'conversations',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `cv_${createId()}`),
    tenantId: text('tenant_id').notNull(),
    /** Owner key — for Zoho widget chats this is `zoho:<zoho_user_id>` (see chat.routes). */
    userId: text('user_id').notNull(),
    audience: text('audience').$type<Audience>().notNull(),
    title: text('title'),
    status: text('status').$type<'active' | 'archived'>().notNull().default('active'),
    // --- Zoho widget session metadata (nullable; set on first stream turn / explicit create) ---
    zohoUserId: text('zoho_user_id'),
    userName: text('user_name'),
    profile: text('profile'),
    role: text('role'),
    /** Last/seed department_scope used (string or string[]). */
    departmentScope: jsonb('department_scope').$type<string | string[]>(),
    /** Running count of clean transcript messages (user + assistant), bumped +2 per turn. */
    messageCount: integer('message_count').notNull().default(0),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    /** Bumped on every appended message; drives most-recent-first list ordering. */
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantIdx: index('conversations_tenant_idx').on(table.tenantId),
    userIdx: index('conversations_user_idx').on(table.tenantId, table.userId),
    userRecentIdx: index('conversations_user_recent_idx').on(
      table.tenantId,
      table.userId,
      table.lastMessageAt,
    ),
  }),
);

export type Conversation = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;
