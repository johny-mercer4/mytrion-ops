import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  kpiDailyMetricValues,
  kpiDailyRollups,
} from '../db/schema/index.js';
import type { TenantContext } from '../types/tenantContext.js';
import type { KpiMetricValueInput } from './kpiRepo.js';

export interface KpiWorkerDailyValues {
  workerId: string;
  values: KpiMetricValueInput[];
}

export const kpiDailyBatchRepo = {
  /**
   * One transaction and two set-based writes per reporting day, independent of population size.
   * This keeps reconciliation practical on the small managed Postgres instance.
   */
  async upsertDay(
    ctx: TenantContext,
    reportingDate: string,
    timezone: string,
    workers: KpiWorkerDailyValues[],
    sourceWatermarks: Record<string, string>,
  ): Promise<number> {
    if (workers.length === 0) return 0;
    return db.transaction(async (tx) => {
      const rollups = await tx
        .insert(kpiDailyRollups)
        .values(workers.map((worker) => ({
          tenantId: ctx.tenantId,
          workerId: worker.workerId,
          reportingDate,
          timezone,
          sourceWatermarks,
        })))
        .onConflictDoUpdate({
          target: [
            kpiDailyRollups.tenantId,
            kpiDailyRollups.workerId,
            kpiDailyRollups.reportingDate,
            kpiDailyRollups.calculationVersion,
          ],
          set: {
            sourceWatermarks: sql`excluded.source_watermarks`,
            computedAt: new Date(),
          },
        })
        .returning({
          id: kpiDailyRollups.id,
          workerId: kpiDailyRollups.workerId,
        });
      const rollupByWorker = new Map(
        rollups.map((rollup) => [rollup.workerId, rollup.id]),
      );
      const values = workers.flatMap((worker) => {
        const rollupId = rollupByWorker.get(worker.workerId);
        if (!rollupId) return [];
        return worker.values.map((value) => ({
          tenantId: ctx.tenantId,
          rollupId,
          metricKey: value.metricKey,
          metricVersion: value.metricVersion ?? 1,
          numericValue: value.numericValue,
          numerator: value.numerator ?? null,
          denominator: value.denominator ?? null,
          dataStatus: value.dataStatus,
        }));
      });
      if (values.length > 0) {
        await tx
          .insert(kpiDailyMetricValues)
          .values(values)
          .onConflictDoUpdate({
            target: [
              kpiDailyMetricValues.tenantId,
              kpiDailyMetricValues.rollupId,
              kpiDailyMetricValues.metricKey,
              kpiDailyMetricValues.metricVersion,
            ],
            set: {
              numericValue: sql`excluded.numeric_value`,
              numerator: sql`excluded.numerator`,
              denominator: sql`excluded.denominator`,
              dataStatus: sql`excluded.data_status`,
            },
          });
      }
      return rollups.length;
    });
  },
};
