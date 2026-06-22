import { createId } from '@paralleldrive/cuid2';
import { index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/** The three editable lists shown per lifecycle node in the Octane Scope widget. */
export type ScopeRiskCategory = 'blocker' | 'red_flag' | 'manual';

/**
 * scope_risk_items — user-editable Blockers / Red Flags / Manual Processes for each
 * Octane lifecycle node (lead-generation, lead-cycle, wex-cycle, deal-cycle, and any
 * after-lifecycle node added later). Written from the Mytrion RnD widget via /v1/scope/*.
 * `nodeId` and `icon` are free strings — the widget owns their meaning.
 */
export const scopeRiskItems = pgTable(
  'scope_risk_items',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `ri_${createId()}`),
    tenantId: text('tenant_id').notNull(),
    nodeId: text('node_id').notNull(),
    category: text('category').$type<ScopeRiskCategory>().notNull(),
    label: text('label').notNull(),
    /** Icon key the widget maps to a glyph; unknown/empty falls back to a dot widget-side. */
    icon: text('icon').notNull().default(''),
    position: integer('position').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    nodeIdx: index('scope_risk_items_node_idx').on(
      table.tenantId,
      table.nodeId,
      table.category,
      table.position,
    ),
  }),
);

export type ScopeRiskItem = typeof scopeRiskItems.$inferSelect;
export type NewScopeRiskItem = typeof scopeRiskItems.$inferInsert;
