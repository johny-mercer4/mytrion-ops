import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.FF_MYTRION_USAGE_COLLECTION_ENABLED = '0';
});

const directory = vi.hoisted(() => vi.fn(async () => []));
const rollup = vi.hoisted(() => vi.fn(async () => ({ workers: 1, days: 1, rollups: 1 })));
const audit = vi.hoisted(() => vi.fn(async () => undefined));
const deleteRaw = vi.hoisted(() => vi.fn());
const deleteDaily = vi.hoisted(() => vi.fn(async () => 0));

vi.mock('../../src/modules/kpi/directoryCollector.js', () => ({
  syncKpiWorkerDirectory: directory,
}));
vi.mock('../../src/modules/kpi/usageRollup.js', () => ({
  computeUsageDailyRollups: rollup,
}));
vi.mock('../../src/modules/audit/auditLogger.js', () => ({
  auditFromContext: audit,
}));
vi.mock('../../src/repos/kpiUsageRetentionRepo.js', () => ({
  kpiUsageRetentionRepo: {
    deleteRolledUpRaw: deleteRaw,
    deleteDailyRollups: deleteDaily,
  },
}));

import {
  runMytrionUsageDaily,
  runMytrionUsageRetention,
} from '../../src/modules/jobs/workers/mytrionUsage.js';

describe('Sales Mytrion usage flag rollout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deleteRaw.mockResolvedValue({
      activityEvents: 0,
      presenceEvents: 0,
      presenceSessions: 0,
    });
  });

  it('allows a bounded manual backfill while scheduled collection is off', async () => {
    const result = await runMytrionUsageDaily({
      trigger: 'manual',
      days: ['2026-05-21', '2026-05-20'],
    });

    expect(directory).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'octane', departments: ['sales'] }),
      new Date('2026-05-20T04:00:00.000Z'),
    );
    expect(rollup).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'octane', departments: ['sales'] }),
      ['2026-05-21', '2026-05-20'],
    );
    expect(result).toMatchObject({ enabled: false, manual: true, rollups: 1 });
  });

  it('keeps a cron/direct non-manual run dark while the flag is off', async () => {
    expect(await runMytrionUsageDaily({})).toEqual({ enabled: false });
    expect(directory).not.toHaveBeenCalled();
    expect(rollup).not.toHaveBeenCalled();
  });

  it('continues retention while collection is off and drains multiple bounded batches', async () => {
    deleteRaw
      .mockResolvedValueOnce({
        activityEvents: 10_000,
        presenceEvents: 10_000,
        presenceSessions: 0,
      })
      .mockResolvedValueOnce({
        activityEvents: 20,
        presenceEvents: 30,
        presenceSessions: 1,
      });

    const result = await runMytrionUsageRetention({});

    expect(deleteRaw).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      enabled: true,
      collectionEnabled: false,
      retentionBatches: 2,
      rawDrained: true,
      activityEvents: 10_020,
      presenceEvents: 10_030,
    });
  });

  it('caps a retention drain even when every batch is full', async () => {
    deleteRaw.mockResolvedValue({
      activityEvents: 10_000,
      presenceEvents: 10_000,
      presenceSessions: 10_000,
    });

    const result = await runMytrionUsageRetention({});

    expect(deleteRaw).toHaveBeenCalledTimes(20);
    expect(result).toMatchObject({ retentionBatches: 20, rawDrained: false });
  });
});
