import { describe, expect, it } from 'vitest';
import { sourceCoversDay, spanStatus } from '../../src/modules/analytics/mytrionUsageCoverage.js';
import { resolveMytrionUsageWindow } from '../../src/modules/analytics/mytrionUsageDates.js';

describe('Sales Mytrion source coverage', () => {
  it('uses half-open day boundaries', () => {
    const span = {
      source: 'presence',
      availableFrom: '2026-08-01T04:00:00.000Z',
      availableThrough: '2026-08-02T04:00:00.000Z',
      coveredThrough: '2026-08-02T04:00:00.000Z',
    };
    expect(sourceCoversDay('complete', span, '2026-08-01')).toBe(true);
    expect(sourceCoversDay('partial', span, '2026-08-02')).toBe(false);
    const window = resolveMytrionUsageWindow({
      preset: 'custom', from: '2026-08-02', to: '2026-08-02',
      now: new Date('2026-08-03T16:00:00Z'),
    });
    expect(spanStatus(span, false, window)).toBe('unavailable');
  });
});
