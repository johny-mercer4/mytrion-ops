import { beforeEach, describe, expect, it, vi } from 'vitest';

const repoMocks = vi.hoisted(() => ({
  metricDefinitions: vi.fn(),
  activityMetricsForWorkers: vi.fn(),
}));
const telemetryMocks = vi.hoisted(() => ({
  sourceAvailabilityForDay: vi.fn(),
  lastTelemetryAtForWorkersDay: vi.fn(),
  activeSecondsForWorkersDay: vi.fn(),
  visibleSecondsForWorkersDay: vi.fn(),
}));
const workerMocks = vi.hoisted(() => ({ listEligibleAt: vi.fn() }));
const batchMocks = vi.hoisted(() => ({ upsertDay: vi.fn() }));

vi.mock('../../src/repos/kpiRepo.js', () => ({ kpiRepo: repoMocks }));
vi.mock('../../src/repos/kpiTelemetryRepo.js', () => ({ kpiTelemetryRepo: telemetryMocks }));
vi.mock('../../src/repos/kpiWorkerRepo.js', () => ({ kpiWorkerRepo: workerMocks }));
vi.mock('../../src/repos/kpiDailyBatchRepo.js', () => ({ kpiDailyBatchRepo: batchMocks }));

import { DEFAULT_TENANT_ID } from '../../src/config/constants.js';
import type { KpiWorker } from '../../src/db/schema/index.js';
import { computeUsageDailyRollups } from '../../src/modules/kpi/usageRollup.js';
import {
  MYTRION_USAGE_CALCULATION_VERSION,
  MYTRION_USAGE_METRIC_KEYS,
} from '../../src/modules/kpi/usageMetrics.js';
import { makeContext } from '../fixtures/seed.js';

const now = new Date('2026-08-18T12:00:00.000Z');
const worker: KpiWorker = {
  id: 'kpw_42',
  tenantId: DEFAULT_TENANT_ID,
  zohoUserId: '42',
  displayName: 'Zero Inclusive Agent',
  email: null,
  currentProfileName: 'Sales Agent',
  currentRoleName: 'Agent',
  sourceActive: true,
  firstSeenAt: now,
  lastSeenAt: now,
  createdAt: now,
  updatedAt: now,
};

beforeEach(() => {
  vi.clearAllMocks();
  workerMocks.listEligibleAt.mockResolvedValue([worker]);
  repoMocks.metricDefinitions.mockResolvedValue(
    MYTRION_USAGE_METRIC_KEYS.map((metricKey) => ({ metricKey, version: 1 })),
  );
  repoMocks.activityMetricsForWorkers.mockResolvedValue(
    new Map([['kpw_42', { searches_completed: 2 }]]),
  );
  telemetryMocks.activeSecondsForWorkersDay.mockResolvedValue(new Map([['kpw_42', 120]]));
  telemetryMocks.visibleSecondsForWorkersDay.mockResolvedValue(new Map([['kpw_42', 180]]));
  telemetryMocks.sourceAvailabilityForDay.mockResolvedValue({
    presenceAvailable: true,
    presenceThrough: new Date('2026-08-17T22:00:00.000Z'),
    activityAvailable: true,
    activityThrough: new Date('2026-08-17T21:00:00.000Z'),
  });
  telemetryMocks.lastTelemetryAtForWorkersDay.mockResolvedValue(
    new Map([['kpw_42', new Date('2026-08-17T22:00:00.000Z')]]),
  );
  batchMocks.upsertDay.mockResolvedValue(1);
});

describe('Sales Mytrion usage rollup', () => {
  it('writes the usage calculation version and a zero-inclusive metric set', async () => {
    const result = await computeUsageDailyRollups(
      makeContext({ tenantId: DEFAULT_TENANT_ID, departments: ['sales'] }),
      ['2026-08-17'],
    );

    expect(result).toEqual({ workers: 1, days: 1, rollups: 1 });
    const call = batchMocks.upsertDay.mock.calls[0];
    expect(call?.[5]).toBe(MYTRION_USAGE_CALCULATION_VERSION);
    const values = call?.[3]?.[0]?.values as Array<{
      metricKey: string;
      numericValue: number | null;
      dataStatus: string;
    }>;
    expect(values).toHaveLength(MYTRION_USAGE_METRIC_KEYS.length);
    expect(values).toEqual(expect.arrayContaining([
      expect.objectContaining({ metricKey: 'online_active_seconds', numericValue: 120 }),
      expect.objectContaining({ metricKey: 'online_visible_seconds', numericValue: 180 }),
      expect.objectContaining({ metricKey: 'searches_completed', numericValue: 2 }),
      expect.objectContaining({ metricKey: 'exports_completed', numericValue: 0 }),
      expect.objectContaining({
        metricKey: 'last_telemetry_at_epoch_seconds',
        numericValue: 1_787_004_000,
      }),
    ]));
  });

  it('writes null/unavailable instead of false zeros when collection had no source events', async () => {
    telemetryMocks.sourceAvailabilityForDay.mockResolvedValue({
      presenceAvailable: false,
      presenceThrough: null,
      activityAvailable: false,
      activityThrough: null,
    });
    repoMocks.activityMetricsForWorkers.mockResolvedValue(new Map());
    telemetryMocks.activeSecondsForWorkersDay.mockResolvedValue(new Map());
    telemetryMocks.visibleSecondsForWorkersDay.mockResolvedValue(new Map());
    telemetryMocks.lastTelemetryAtForWorkersDay.mockResolvedValue(new Map());

    await computeUsageDailyRollups(
      makeContext({ tenantId: DEFAULT_TENANT_ID, departments: ['sales'] }),
      ['2026-08-17'],
    );

    const call = batchMocks.upsertDay.mock.calls[0];
    const values = call?.[3]?.[0]?.values as Array<{
      numericValue: number | null;
      dataStatus: string;
    }>;
    expect(values.every((value) => value.numericValue === null)).toBe(true);
    expect(values.every((value) => value.dataStatus === 'unavailable')).toBe(true);
    expect(call?.[4]).toEqual({
      'usage.activity': 'unavailable',
      'usage.presence': 'unavailable',
    });
  });

  it('does not copy another agent’s last telemetry onto a zero-use roster agent', async () => {
    const zeroUseWorker = { ...worker, id: 'kpw_99', zohoUserId: '99', displayName: 'No Use' };
    workerMocks.listEligibleAt.mockResolvedValue([worker, zeroUseWorker]);
    telemetryMocks.lastTelemetryAtForWorkersDay.mockResolvedValue(
      new Map([['kpw_42', new Date('2026-08-17T22:00:00.000Z')]]),
    );

    await computeUsageDailyRollups(
      makeContext({ tenantId: DEFAULT_TENANT_ID, departments: ['sales'] }),
      ['2026-08-17'],
    );

    const workers = batchMocks.upsertDay.mock.calls[0]?.[3] as Array<{
      workerId: string;
      values: Array<{ metricKey: string; numericValue: number | null; dataStatus: string }>;
    }>;
    const lastFor = (workerId: string) => workers
      .find((entry) => entry.workerId === workerId)
      ?.values.find((value) => value.metricKey === 'last_telemetry_at_epoch_seconds');
    expect(lastFor('kpw_42')).toMatchObject({ numericValue: 1_787_004_000, dataStatus: 'complete' });
    expect(lastFor('kpw_99')).toMatchObject({ numericValue: null, dataStatus: 'complete' });
  });
});
