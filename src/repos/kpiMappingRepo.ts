import { createId } from '@paralleldrive/cuid2';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  kpiIngestionRuns,
  kpiUnresolvedWorkerMappings,
  type KpiUnresolvedWorkerMapping,
} from '../db/schema/index.js';
import type { TenantContext } from '../types/tenantContext.js';

export const kpiMappingRepo = {
  async correctRunMappingSummary(
    ctx: TenantContext,
    ingestionRunId: string,
    unresolvedMappings: number,
    error: string | null,
  ): Promise<void> {
    await db
      .update(kpiIngestionRuns)
      .set({ unresolvedMappings, error })
      .where(
        and(
          eq(kpiIngestionRuns.tenantId, ctx.tenantId),
          eq(kpiIngestionRuns.id, ingestionRunId),
        ),
      );
  },

  async recordUnresolved(
    ctx: TenantContext,
    input: {
      source: string;
      sourceKey: string;
      observedLabel?: string | null;
      reason: string;
      ingestionRunId: string;
    },
  ): Promise<void> {
    await db.execute(sql`
      insert into "kpi_unresolved_worker_mappings" (
        "id", "tenant_id", "source", "source_key", "observed_label",
        "reason", "ingestion_run_id"
      )
      values (
        ${`kum_${createId()}`},
        ${ctx.tenantId},
        ${input.source},
        ${input.sourceKey},
        ${input.observedLabel ?? null},
        ${input.reason},
        ${input.ingestionRunId}
      )
      on conflict ("tenant_id", "source", "source_key")
        where "resolved_at" is null
      do update set
        "observed_label" = excluded."observed_label",
        "reason" = excluded."reason",
        "ingestion_run_id" = excluded."ingestion_run_id",
        "occurrence_count" =
          "kpi_unresolved_worker_mappings"."occurrence_count" + 1,
        "last_seen_at" = now()
    `);
  },

  async listUnresolved(
    ctx: TenantContext,
    limit = 200,
  ): Promise<KpiUnresolvedWorkerMapping[]> {
    return db
      .select()
      .from(kpiUnresolvedWorkerMappings)
      .where(
        and(
          eq(kpiUnresolvedWorkerMappings.tenantId, ctx.tenantId),
          isNull(kpiUnresolvedWorkerMappings.resolvedAt),
        ),
      )
      .orderBy(desc(kpiUnresolvedWorkerMappings.lastSeenAt))
      .limit(Math.min(Math.max(limit, 1), 500));
  },
};
