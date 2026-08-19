/**
 * commsAnalyticsRepo.summary — execution smoke test.
 *
 * The RBAC-leakage suite proves the gate offline with `.toSQL()`; this one actually RUNS the query
 * against the test Postgres so a syntax slip in the conditional aggregates, the `FILTER (WHERE … IN …)`
 * fragments, or the `to_char(… AT TIME ZONE 'UTC')` daily buckets fails loudly. It is scoped to a
 * throwaway tenant that owns no rows, so the result is deterministically empty regardless of what other
 * suites have written — which lets it assert the exact SHAPE the dashboard depends on.
 */
import { describe, expect, it } from 'vitest';
import { commsAnalyticsRepo } from '../../src/repos/commsAnalyticsRepo.js';
import type { TenantContext } from '../../src/types/tenantContext.js';

const ctx = {
  tenantId: 'analytics-smoke-test',
  userId: 'zoho:1',
  audience: 'internal',
  role: 'worker',
  scopes: [],
  departments: ['customer-service'],
  allDepartmentAccess: false,
  requestId: 'req_analytics',
} as unknown as TenantContext;

describe('commsAnalyticsRepo.summary', () => {
  it('runs every aggregate and returns a well-formed, zeroed summary for an empty tenant', async () => {
    const a = await commsAnalyticsRepo.summary(ctx, { sinceDays: 7 });

    expect(a.window.sinceDays).toBe(7);
    expect(a.totals).toEqual({ all: 0, open: 0, resolved: 0, closed: 0, overdue: 0, breached: 0 });
    expect(a.sla.firstResponseMet).toBe(0);
    expect(a.sla.firstResponseMissed).toBe(0);
    expect(a.sla.firstResponsePending).toBe(0);
    // No resolved tickets → the average is null, not 0 or NaN.
    expect(a.sla.avgResolutionHours).toBeNull();
    expect(a.sla.avgFirstResponseHours).toBeNull();
    expect(a.byStatus).toEqual([]);
    expect(a.byPriority).toEqual([]);
    expect(a.byDepartment).toEqual([]);
    expect(a.topAssignees).toEqual([]);
    // The daily series is dense: one bucket per day in the window, all zero.
    expect(a.volume).toHaveLength(7);
    for (const day of a.volume) {
      expect(day).toMatchObject({ created: 0, resolved: 0 });
      expect(day.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('clamps the window (0 → 1, 9999 → 365)', async () => {
    expect((await commsAnalyticsRepo.summary(ctx, { sinceDays: 0 })).window.sinceDays).toBe(1);
    expect((await commsAnalyticsRepo.summary(ctx, { sinceDays: 9999 })).window.sinceDays).toBe(365);
  });
});
