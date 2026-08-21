import { createId } from '@paralleldrive/cuid2';
import { index, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

/**
 * worker_zoho_tokens — one row per (tenant, Zoho user): the long-lived Zoho OAuth refresh token
 * minted when the worker logs in via the server-app auth code flow. Used to make CRM API calls
 * on behalf of the real agent so that Zoho's "Created By" / "Modified By" fields reflect the
 * agent rather than the shared service account.
 *
 * Token is written/refreshed on every login. The in-process ZohoUserAuthService caches the
 * derived access token (TTL ~1 hour) so DB reads are rare at runtime.
 */
export const workerZohoTokens = pgTable(
  'worker_zoho_tokens',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `wzt_${createId()}`),
    tenantId: text('tenant_id').notNull(),
    zohoUserId: text('zoho_user_id').notNull(),
    refreshToken: text('refresh_token').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantUserUk: uniqueIndex('worker_zoho_tokens_tenant_user_uk').on(
      table.tenantId,
      table.zohoUserId,
    ),
    tenantIdx: index('worker_zoho_tokens_tenant_idx').on(table.tenantId),
  }),
);

export type WorkerZohoToken = typeof workerZohoTokens.$inferSelect;
export type NewWorkerZohoToken = typeof workerZohoTokens.$inferInsert;
