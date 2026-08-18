import { beforeEach, describe, expect, it, vi } from 'vitest';

const enqueue = vi.hoisted(() => vi.fn(async () => 'job_usage_1'));

vi.mock('../../src/modules/jobs/queue.js', () => ({ enqueue }));

import { triggerCatalogJob } from '../../src/modules/jobs/adminTrigger.js';
import { mytrionUsageDailyJob } from '../../src/modules/jobs/catalog.js';

describe('Sales Mytrion usage manual backfill', () => {
  beforeEach(() => enqueue.mockClear());

  it('preserves validated date chunks and stamps the manual trigger', async () => {
    const days = ['2026-05-20', '2026-05-21'];
    await triggerCatalogJob(mytrionUsageDailyJob.name, { days });

    expect(enqueue).toHaveBeenCalledWith(
      mytrionUsageDailyJob,
      { days, trigger: 'manual' },
    );
  });

  it('bounds a manual chunk to 31 valid reporting dates', () => {
    expect(() => mytrionUsageDailyJob.schema.parse({
      trigger: 'manual',
      days: Array.from({ length: 32 }, (_, index) => `2026-05-${String(index + 1).padStart(2, '0')}`),
    })).toThrow();
    expect(() => mytrionUsageDailyJob.schema.parse({
      trigger: 'manual',
      days: ['not-a-date'],
    })).toThrow();
  });
});
