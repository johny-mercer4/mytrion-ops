import { describe, expect, it } from 'vitest';
import { usageRetentionCutoffs } from '../../src/modules/jobs/workers/mytrionUsage.js';

describe('Sales Mytrion usage retention cutoffs', () => {
  it('uses reporting-zone calendar boundaries for 90 days and 13 months', () => {
    const cutoffs = usageRetentionCutoffs(new Date('2026-08-18T16:00:00.000Z'));
    expect(cutoffs.rawBefore.toISOString()).toBe('2026-05-20T04:00:00.000Z');
    expect(cutoffs.dailyBefore).toBe('2025-07-18');
  });
});
