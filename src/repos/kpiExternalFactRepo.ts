import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  kpiExternalFacts,
  type KpiDataStatus,
  type KpiExternalFact,
} from '../db/schema/index.js';
import type { TenantContext } from '../types/tenantContext.js';
import { firstOrThrow } from './util.js';

export interface ExternalFactInput {
  workerId: string;
  ingestionRunId: string;
  source: string;
  sourceKey: string;
  metricKey: string;
  occurredAt: Date;
  reportingDate: string;
  numericValue: number;
  dataStatus?: KpiDataStatus;
  dimensions?: Record<string, string | number | boolean | null> | null;
}

function sameDimensions(
  a: Record<string, string | number | boolean | null> | null,
  b: Record<string, string | number | boolean | null> | null,
): boolean {
  const stable = (value: typeof a): string =>
    JSON.stringify(
      Object.fromEntries(Object.entries(value ?? {}).sort(([left], [right]) => left.localeCompare(right))),
    );
  return stable(a) === stable(b);
}

export const kpiExternalFactRepo = {
  async countByIngestionRun(ctx: TenantContext, ingestionRunId: string): Promise<number> {
    const rows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(kpiExternalFacts)
      .where(
        and(
          eq(kpiExternalFacts.tenantId, ctx.tenantId),
          eq(kpiExternalFacts.ingestionRunId, ingestionRunId),
        ),
      );
    return rows[0]?.count ?? 0;
  },

  /** Append only when a source observation changed; retries return the current revision. */
  async append(
    ctx: TenantContext,
    input: ExternalFactInput,
  ): Promise<{ fact: KpiExternalFact; inserted: boolean }> {
    const latest = await this.latest(ctx, input.source, input.sourceKey, input.metricKey);
    const status = input.dataStatus ?? 'complete';
    const dimensions = input.dimensions ?? null;
    if (
      latest &&
      latest.workerId === input.workerId &&
      latest.occurredAt.getTime() === input.occurredAt.getTime() &&
      latest.reportingDate === input.reportingDate &&
      latest.numericValue === input.numericValue &&
      latest.dataStatus === status &&
      sameDimensions(latest.dimensions, dimensions)
    ) {
      return { fact: latest, inserted: false };
    }
    const rows = await db
      .insert(kpiExternalFacts)
      .values({
        tenantId: ctx.tenantId,
        workerId: input.workerId,
        ingestionRunId: input.ingestionRunId,
        source: input.source,
        sourceKey: input.sourceKey,
        metricKey: input.metricKey,
        revision: (latest?.revision ?? 0) + 1,
        occurredAt: input.occurredAt,
        reportingDate: input.reportingDate,
        numericValue: input.numericValue,
        dataStatus: status,
        dimensions,
        supersedesId: latest?.id ?? null,
      })
      .returning();
    return { fact: firstOrThrow(rows, 'Failed to append KPI fact'), inserted: true };
  },

  /**
   * Set-based revision insertion. One SQL statement per 500 observations replaces thousands of
   * source-key lookups during reconciliation/backfill while preserving the same revision rules.
   */
  async appendBatch(
    ctx: TenantContext,
    inputs: ExternalFactInput[],
  ): Promise<{ inserted: number; reportingDates: string[] }> {
    let inserted = 0;
    const reportingDates = new Set<string>();
    for (let offset = 0; offset < inputs.length; offset += 500) {
      const payload = inputs.slice(offset, offset + 500).map((input) => ({
        worker_id: input.workerId,
        ingestion_run_id: input.ingestionRunId,
        source: input.source,
        source_key: input.sourceKey,
        metric_key: input.metricKey,
        occurred_at: input.occurredAt.toISOString(),
        reporting_date: input.reportingDate,
        numeric_value: input.numericValue,
        data_status: input.dataStatus ?? 'complete',
        dimensions: input.dimensions ?? null,
      }));
      const rows = await db.execute(sql`
        with incoming as (
          select *
          from jsonb_to_recordset(${JSON.stringify(payload)}::jsonb) as item(
            worker_id text,
            ingestion_run_id text,
            source text,
            source_key text,
            metric_key text,
            occurred_at timestamptz,
            reporting_date date,
            numeric_value double precision,
            data_status text,
            dimensions jsonb
          )
        ),
        resolved as (
          select
            i.*,
            latest.id as latest_id,
            latest.worker_id as latest_worker_id,
            latest.revision as latest_revision,
            latest.occurred_at as latest_occurred_at,
            latest.reporting_date as latest_reporting_date,
            latest.numeric_value as latest_numeric_value,
            latest.data_status as latest_data_status,
            latest.dimensions as latest_dimensions
          from incoming i
          left join lateral (
            select f.*
            from kpi_external_facts f
            where f.tenant_id = ${ctx.tenantId}
              and f.source = i.source
              and f.source_key = i.source_key
              and f.metric_key = i.metric_key
            order by f.revision desc
            limit 1
          ) latest on true
        ),
        new_rows as (
          insert into kpi_external_facts (
            tenant_id, worker_id, ingestion_run_id, source, source_key, metric_key,
            revision, occurred_at, reporting_date, numeric_value, data_status,
            dimensions, supersedes_id
          )
          select
            ${ctx.tenantId}, worker_id, ingestion_run_id, source, source_key, metric_key,
            coalesce(latest_revision, 0) + 1, occurred_at, reporting_date, numeric_value,
            data_status, dimensions, latest_id
          from resolved
          where latest_id is null
            or latest_worker_id is distinct from worker_id
            or latest_occurred_at is distinct from occurred_at
            or latest_reporting_date is distinct from reporting_date
            or latest_numeric_value is distinct from numeric_value
            or latest_data_status is distinct from data_status
            or latest_dimensions is distinct from dimensions
          on conflict do nothing
          returning id, reporting_date
        )
        select
          count(*)::int as inserted,
          coalesce(jsonb_agg(distinct reporting_date), '[]'::jsonb) as reporting_dates
        from new_rows
      `);
      inserted += Number(rows[0]?.inserted ?? 0);
      const dates = rows[0]?.reporting_dates;
      if (Array.isArray(dates)) {
        for (const date of dates) reportingDates.add(String(date).slice(0, 10));
      }
    }
    return { inserted, reportingDates: Array.from(reportingDates) };
  },

  async latest(
    ctx: TenantContext,
    source: string,
    sourceKey: string,
    metricKey: string,
  ): Promise<KpiExternalFact | undefined> {
    const rows = await db
      .select()
      .from(kpiExternalFacts)
      .where(
        and(
          eq(kpiExternalFacts.tenantId, ctx.tenantId),
          eq(kpiExternalFacts.source, source),
          eq(kpiExternalFacts.sourceKey, sourceKey),
          eq(kpiExternalFacts.metricKey, metricKey),
        ),
      )
      .orderBy(desc(kpiExternalFacts.revision))
      .limit(1);
    return rows[0];
  },

  async latestForKeys(
    ctx: TenantContext,
    source: string,
    sourceKeys: string[],
    metricKeys: string[],
  ): Promise<Map<string, KpiExternalFact>> {
    const result = new Map<string, KpiExternalFact>();
    for (let offset = 0; offset < sourceKeys.length; offset += 500) {
      const keys = sourceKeys.slice(offset, offset + 500);
      if (!keys.length) continue;
      const rows = await db
        .select()
        .from(kpiExternalFacts)
        .where(
          and(
            eq(kpiExternalFacts.tenantId, ctx.tenantId),
            eq(kpiExternalFacts.source, source),
            inArray(kpiExternalFacts.sourceKey, keys),
            inArray(kpiExternalFacts.metricKey, metricKeys),
          ),
        )
        .orderBy(
          kpiExternalFacts.sourceKey,
          kpiExternalFacts.metricKey,
          desc(kpiExternalFacts.revision),
        );
      for (const row of rows) {
        const key = `${row.sourceKey}\u0000${row.metricKey}`;
        if (!result.has(key)) result.set(key, row);
      }
    }
    return result;
  },
};
