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
    s3Key: text('s3_key').notNull(),
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
  }),
);

export type FileAsset = typeof fileAssets.$inferSelect;
export type NewFileAsset = typeof fileAssets.$inferInsert;
