import { describe, expect, it } from 'vitest';
import {
  CRON_SCHEDULES,
  kpiSalesDailyRollupJob,
  kpiSalesHourlySyncJob,
  kpiSalesMonthCloseJob,
  kpiSalesReconcileJob,
} from '../../src/modules/jobs/catalog.js';

describe('Sales KPI jobs', () => {
  it('uses New York time without changing the global job timezone', () => {
    const names = new Set([
      kpiSalesHourlySyncJob.name,
      kpiSalesReconcileJob.name,
      kpiSalesDailyRollupJob.name,
      kpiSalesMonthCloseJob.name,
    ]);
    const schedules = CRON_SCHEDULES.filter((entry) => names.has(entry.name));
    expect(schedules).toHaveLength(4);
    expect(schedules.every((entry) => entry.timezone === 'America/New_York')).toBe(true);
    expect(schedules.find((entry) => entry.name === kpiSalesMonthCloseJob.name)?.cron).toBe(
      '15 0 3 * *',
    );
  });

  it('bounds manual reconciliation and backfill to 90 days', () => {
    expect(
      kpiSalesReconcileJob.schema.parse({
        lookbackDays: 90,
        mode: 'backfill',
        trigger: 'manual',
      }),
    ).toEqual({ lookbackDays: 90, mode: 'backfill', trigger: 'manual' });
    expect(() => kpiSalesReconcileJob.schema.parse({ lookbackDays: 91 })).toThrow();
  });
});
