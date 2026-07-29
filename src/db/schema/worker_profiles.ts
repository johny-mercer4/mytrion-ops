import { index, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { createId } from '@paralleldrive/cuid2';

/**
 * Per-Zoho-worker prefs that are not access grants (those live in `worker_mytrion_access`).
 *
 * Avatar is a small data-URL (client-resized JPEG/PNG) so profile pictures work without requiring
 * S3/`FF_FILES_ENABLED`. Cap enforced at the route — this column must not become a dump for large
 * binaries.
 */
export const workerProfiles = pgTable(
  'worker_profiles',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    tenantId: text('tenant_id').notNull(),
    zohoUserId: text('zoho_user_id').notNull(),
    /** `data:image/...;base64,...` — nullable until the worker uploads a picture. */
    avatarDataUrl: text('avatar_data_url'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantUserUk: uniqueIndex('worker_profiles_tenant_user_uk').on(table.tenantId, table.zohoUserId),
    tenantIdx: index('worker_profiles_tenant_idx').on(table.tenantId),
  }),
);

export type WorkerProfile = typeof workerProfiles.$inferSelect;
export type NewWorkerProfile = typeof workerProfiles.$inferInsert;
