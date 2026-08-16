import { createId } from '@paralleldrive/cuid2';
import { index, integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import type { Audience } from '../../types/tenantContext.js';

/**
 * Files the assistant generates (reports) or receives (uploads for analysis), stored in
 * MinIO/S3; this row is the tenant-scoped catalog entry. Read RBAC is partitioned by AUDIENCE
 * first (a customer never sees internal files and vice-versa), then: customers see only files
 * they OWN; internal/partner callers see department-NULL (global-within-audience), their
 * departments, or their own files; admins see their whole audience.
 */
export const fileAssets = pgTable(
  'file_assets',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    tenantId: text('tenant_id').notNull(),
    /** Isolation partition — customer files never mix with internal files. */
    audience: text('audience').$type<Audience>().notNull().default('internal'),
    /** Requester/owner (e.g. 'zoho:123', 'customer:tg:9', 'system:scheduler'); NULL = system. */
    ownerUserId: text('owner_user_id'),
    departmentAccess: text('department_access'),
    name: text('name').notNull(),
    mime: text('mime').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    /**
     * Storage key. Named for S3 historically; it is the provider-agnostic key, mapped to a Dropbox path by
     * the Dropbox adapter. Renaming the column would be a migration for no behavioural gain.
     */
    s3Key: text('s3_key').notNull(),
    /**
     * WHERE THESE BYTES ACTUALLY ARE. Resolved through `storageFor()` on every read and delete.
     *
     * Per-row rather than a single global setting, because comms attachments go to Dropbox while every
     * pre-existing row is on S3 — a global switch would repoint reads for those and they would 404. It is
     * also what makes delete correct: handing a Dropbox key to the S3 client would report success and leave
     * the object behind.
     */
    storageProvider: text('storage_provider')
      .$type<'s3' | 'dropbox' | 'dropbox_hr'>()
      .notNull()
      .default('s3'),
    kind: text('kind').$type<'generated' | 'upload'>().notNull(),
    /** Producing tool ('file.generate_excel') or route ('files.upload'). */
    createdBy: text('created_by'),
    agentTaskId: text('agent_task_id'),
    conversationId: text('conversation_id'),
    status: text('status').$type<'ready' | 'deleted'>().notNull().default('ready'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantIdx: index('file_assets_tenant_idx').on(table.tenantId, table.createdAt),
    ownerIdx: index('file_assets_owner_idx').on(table.tenantId, table.ownerUserId),
    /** "every Dropbox object for this tenant" — the cleanup sweep and the reconciliation report. */
    providerIdx: index('file_assets_tenant_provider_idx').on(table.tenantId, table.storageProvider),
  }),
);

export type FileAsset = typeof fileAssets.$inferSelect;
export type NewFileAsset = typeof fileAssets.$inferInsert;
