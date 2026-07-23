import { createId } from '@paralleldrive/cuid2';
import { index, integer, jsonb, pgTable, real, text, timestamp, vector } from 'drizzle-orm/pg-core';
import type { Audience } from '../../types/tenantContext.js';

/**
 * Procedural skill cache — distilled winning tool trajectories (suggestion-only; never auto-run).
 * Always recalled as a hint; execution still goes through dispatchTool + RBAC.
 */
export const agentSkills = pgTable(
  'agent_skills',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    tenantId: text('tenant_id').notNull(),
    audience: text('audience').$type<Audience>().notNull(),
    agentKey: text('agent_key').notNull(),
    departmentAccess: text('department_access'),
    queryPattern: text('query_pattern').notNull(),
    trajectoryJson: jsonb('trajectory_json').$type<unknown>().notNull(),
    toolsUsed: jsonb('tools_used').$type<string[]>().notNull().default([]),
    schemaVersion: text('schema_version').notNull().default('1'),
    embedding: vector('embedding', { dimensions: 1536 }),
    successCount: integer('success_count').notNull().default(1),
    importance: real('importance').notNull().default(0.6),
    accessCount: integer('access_count').notNull().default(0),
    lastAccessedAt: timestamp('last_accessed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantAgentIdx: index('agent_skills_tenant_idx').on(table.tenantId, table.agentKey),
    embeddingIdx: index('agent_skills_embedding_idx').using('hnsw', table.embedding.op('vector_cosine_ops')),
  }),
);

export type AgentSkill = typeof agentSkills.$inferSelect;
export type NewAgentSkill = typeof agentSkills.$inferInsert;
