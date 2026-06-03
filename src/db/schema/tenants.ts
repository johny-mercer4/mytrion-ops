import { createId } from '@paralleldrive/cuid2';
import { jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import type { Audience } from '../../types/tenantContext.js';

/**
 * A tenant is an isolation boundary. 'octane' is the single internal tenant;
 * each partner org gets its own tenant row. Every other table carries tenant_id.
 */
export const tenants = pgTable('tenants', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  name: text('name').notNull(),
  audience: text('audience').$type<Audience>().notNull(),
  status: text('status').$type<'active' | 'suspended'>().notNull().default('active'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;
