import { createId } from '@paralleldrive/cuid2';
import { index, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import type { Audience, Role } from '../../types/tenantContext.js';

// NOTE: cross-table relationships (tenant_id -> tenants.id, etc.) are intentionally
// NOT declared as DB foreign keys. Isolation + integrity are enforced in the repo
// layer (see CLAUDE.md). This also keeps each schema file free of value-level
// sibling imports so drizzle-kit can load them individually.
export const users = pgTable(
  'users',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    tenantId: text('tenant_id').notNull(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    fullName: text('full_name'),
    role: text('role').$type<Role>().notNull(),
    audience: text('audience').$type<Audience>().notNull(),
    status: text('status').$type<'active' | 'disabled'>().notNull().default('active'),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    emailTenantUnique: uniqueIndex('users_tenant_email_uk').on(table.tenantId, table.email),
    tenantIdx: index('users_tenant_idx').on(table.tenantId),
  }),
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
