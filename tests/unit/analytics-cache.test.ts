import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the DWH-backed compute so no test touches a database.
vi.mock('../../src/modules/analytics/service.js', () => ({
  computeAnalyticsBlock: vi.fn(),
}));

import { computeAnalyticsBlock } from '../../src/modules/analytics/service.js';
import {
  getAnalyticsSnapshot,
  refreshAllAnalytics,
  resetAnalyticsCache,
} from '../../src/modules/analytics/cache.js';
import type { AnalyticsBlock } from '../../src/modules/analytics/types.js';

const computeMock = vi.mocked(computeAnalyticsBlock);

function block(label: string): AnalyticsBlock {
  return {
    label,
    caption: 'c',
    kpis: [],
    trendLabel: 't',
    trend: [],
    breakdownLabel: 'b',
    breakdown: [],
    leaderboardLabel: 'l',
    leaderboardCols: ['a', 'b', 'c'],
    leaderboard: [],
  };
}

describe('analytics snapshot cache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetAnalyticsCache();
    computeMock.mockReset();
    computeMock.mockResolvedValue(block('v1'));
  });

  afterEach(() => {
    resetAnalyticsCache();
    vi.useRealTimers();
  });

  it('computes once and serves from cache within the TTL', async () => {
    const first = await getAnalyticsSnapshot('pipeline');
    const second = await getAnalyticsSnapshot('pipeline');
    expect(first.block.label).toBe('v1');
    expect(second).toBe(first); // same cached object
    expect(computeMock).toHaveBeenCalledTimes(1);
  });

  it('self-expires after the TTL and recomputes (2h default)', async () => {
    await getAnalyticsSnapshot('pipeline');
    computeMock.mockResolvedValue(block('v2'));

    vi.advanceTimersByTime(119 * 60_000); // still inside 120min TTL
    expect((await getAnalyticsSnapshot('pipeline')).block.label).toBe('v1');

    vi.advanceTimersByTime(2 * 60_000); // past the TTL → stale → recompute
    expect((await getAnalyticsSnapshot('pipeline')).block.label).toBe('v2');
    expect(computeMock).toHaveBeenCalledTimes(2);
  });

  it('force refresh bypasses a fresh cache', async () => {
    await getAnalyticsSnapshot('pipeline');
    computeMock.mockResolvedValue(block('forced'));
    const forced = await getAnalyticsSnapshot('pipeline', { force: true });
    expect(forced.block.label).toBe('forced');
    expect(computeMock).toHaveBeenCalledTimes(2);
  });

  it('dedupes concurrent computes per dimension (no DWH stampede)', async () => {
    let release!: (b: AnalyticsBlock) => void;
    computeMock.mockReturnValue(new Promise((res) => (release = res)));
    const a = getAnalyticsSnapshot('transactions');
    const b = getAnalyticsSnapshot('transactions');
    release(block('shared'));
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra).toBe(rb);
    expect(computeMock).toHaveBeenCalledTimes(1);
  });

  it('refreshAllAnalytics never throws when a dimension fails', async () => {
    computeMock.mockRejectedValue(new Error('dwh down'));
    await expect(refreshAllAnalytics()).resolves.toBeUndefined();
  });

  it('an error for one dimension does not poison another', async () => {
    computeMock.mockRejectedValueOnce(new Error('dwh down'));
    await expect(getAnalyticsSnapshot('billing')).rejects.toThrow('dwh down');
    computeMock.mockResolvedValue(block('ok'));
    expect((await getAnalyticsSnapshot('billing')).block.label).toBe('ok');
  });
});
