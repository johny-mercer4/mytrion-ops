import { describe, expect, it } from 'vitest';
import {
  resolveMytrionUsageWindow,
  zonedDayStart,
} from '../../src/modules/analytics/mytrionUsageDates.js';

describe('Sales Mytrion reporting window', () => {
  it('uses half-open New York bounds across the spring DST day', () => {
    const start = zonedDayStart('2026-03-08');
    const end = zonedDayStart('2026-03-09');
    expect(start.toISOString()).toBe('2026-03-08T05:00:00.000Z');
    expect((end.getTime() - start.getTime()) / 3_600_000).toBe(23);
  });

  it('uses half-open New York bounds across the fall DST day', () => {
    const start = zonedDayStart('2026-11-01');
    const end = zonedDayStart('2026-11-02');
    expect(start.toISOString()).toBe('2026-11-01T04:00:00.000Z');
    expect((end.getTime() - start.getTime()) / 3_600_000).toBe(25);
  });

  it('resolves the default month against New York, not the server locale', () => {
    const window = resolveMytrionUsageWindow({ now: new Date('2026-09-01T02:00:00Z') });
    expect(window).toMatchObject({ preset: 'this_month', from: '2026-08-01', to: '2026-08-31' });
  });

  it('rejects reversed and overlong custom ranges', () => {
    expect(() => resolveMytrionUsageWindow({ preset: 'custom', from: '2026-08-02', to: '2026-08-01' })).toThrow();
    expect(() => resolveMytrionUsageWindow({ preset: 'custom', from: '2025-01-01', to: '2026-02-01' })).toThrow();
    expect(() => resolveMytrionUsageWindow({ preset: 'custom', from: '2026-02-31', to: '2026-03-01' })).toThrow();
  });

  it('rejects custom ranges that extend beyond the reporting day', () => {
    expect(() => resolveMytrionUsageWindow({
      preset: 'custom',
      from: '2026-08-18',
      to: '2026-08-19',
      now: new Date('2026-08-18T16:00:00Z'),
    })).toThrow(/future/i);
  });
});
