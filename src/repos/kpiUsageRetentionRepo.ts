import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  kpiDailyMetricValues,
  kpiDailyRollups,
} from '../db/schema/index.js';
import { MYTRION_USAGE_CALCULATION_VERSION } from '../modules/kpi/usageMetrics.js';
import type { TenantContext } from '../types/tenantContext.js';

export interface UsageRetentionResult {
  activityEvents: number;
  presenceEvents: number;
  presenceSessions: number;
  dailyRollups: number;
}

export const kpiUsageRetentionRepo = {
  /**
   * Delete one bounded batch of raw events only when that worker/day has a completed v2 rollup.
   * The transaction-local setting is the only path allowed by the telemetry immutability trigger.
   */
  async deleteRolledUpRaw(
    ctx: TenantContext,
    rawBefore: Date,
    timezone: string,
    batchSize: number,
  ): Promise<Omit<UsageRetentionResult, 'dailyRollups'>> {
    const cutoff = rawBefore.toISOString();
    return db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('octane.kpi_retention_delete', 'on', true)`);
      const activity = await tx.execute(sql`
        with candidates as (
          select e."id"
          from "kpi_activity_events" e
          where e."tenant_id" = ${ctx.tenantId}
            and e."received_at" < ${cutoff}::timestamptz
            and exists (
              select 1
              from "kpi_daily_rollups" r
              where r."tenant_id" = e."tenant_id"
                and r."worker_id" = e."worker_id"
                and r."calculation_version" = ${MYTRION_USAGE_CALCULATION_VERSION}
                and r."reporting_date" = timezone(${timezone}, e."received_at")::date
                and r."source_watermarks" ->> 'usage.activity' like 'complete@%'
            )
          order by e."received_at", e."id"
          limit ${batchSize}
        )
        delete from "kpi_activity_events" e
        using candidates c
        where e."id" = c."id"
        returning e."id"
      `);
      const presence = await tx.execute(sql`
        with candidates as (
          select e."id"
          from "kpi_presence_events" e
          where e."tenant_id" = ${ctx.tenantId}
            and e."received_at" < ${cutoff}::timestamptz
            and exists (
              select 1
              from "kpi_daily_rollups" r
              where r."tenant_id" = e."tenant_id"
                and r."worker_id" = e."worker_id"
                and r."calculation_version" = ${MYTRION_USAGE_CALCULATION_VERSION}
                and r."reporting_date" = timezone(${timezone}, e."received_at")::date
                and r."source_watermarks" ->> 'usage.presence' like 'complete@%'
            )
          order by e."received_at", e."id"
          limit ${batchSize}
        )
        delete from "kpi_presence_events" e
        using candidates c
        where e."id" = c."id"
        returning e."id"
      `);
      const sessions = await tx.execute(sql`
        with candidates as (
          select s."id"
          from "kpi_presence_sessions" s
          where s."tenant_id" = ${ctx.tenantId}
            and s."last_event_at" < ${cutoff}::timestamptz
            and not exists (
              select 1 from "kpi_presence_events" e
              where e."tenant_id" = s."tenant_id" and e."session_id" = s."id"
            )
          order by s."last_event_at", s."id"
          limit ${batchSize}
        )
        delete from "kpi_presence_sessions" s
        using candidates c
        where s."id" = c."id"
        returning s."id"
      `);
      return {
        activityEvents: activity.length,
        presenceEvents: presence.length,
        presenceSessions: sessions.length,
      };
    });
  },

  /** Delete one bounded batch of usage-version daily rows older than the 13-month window. */
  async deleteDailyRollups(
    ctx: TenantContext,
    dailyBefore: string,
    timezone: string,
    batchSize: number,
  ): Promise<number> {
    return db.transaction(async (tx) => {
      const rows = await tx.execute(sql`
        select r."id"
        from "kpi_daily_rollups" r
        where r."tenant_id" = ${ctx.tenantId}
          and r."calculation_version" = ${MYTRION_USAGE_CALCULATION_VERSION}
          and r."reporting_date" < ${dailyBefore}::date
          and not exists (
            select 1 from "kpi_activity_events" e
            where e."tenant_id" = r."tenant_id"
              and e."worker_id" = r."worker_id"
              and timezone(${timezone}, e."received_at")::date = r."reporting_date"
          )
          and not exists (
            select 1 from "kpi_presence_events" e
            where e."tenant_id" = r."tenant_id"
              and e."worker_id" = r."worker_id"
              and timezone(${timezone}, e."received_at")::date = r."reporting_date"
          )
        order by r."reporting_date", r."id"
        limit ${batchSize}
      `);
      const ids = rows.map((row) => String(row.id));
      if (ids.length === 0) return 0;
      await tx
        .delete(kpiDailyMetricValues)
        .where(
          and(
            eq(kpiDailyMetricValues.tenantId, ctx.tenantId),
            inArray(kpiDailyMetricValues.rollupId, ids),
          ),
        );
      const deleted = await tx
        .delete(kpiDailyRollups)
        .where(
          and(
            eq(kpiDailyRollups.tenantId, ctx.tenantId),
            inArray(kpiDailyRollups.id, ids),
          ),
        )
        .returning({ id: kpiDailyRollups.id });
      return deleted.length;
    });
  },
};
