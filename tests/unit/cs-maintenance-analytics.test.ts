/**
 * Maintenance analytics, now computed in Postgres instead of Zoho COQL.
 *
 * The figures here are the ones that pay people ($5 per signed-off case, $2.50 per half), so the
 * arithmetic gets pinned rather than trusted. Two of these cases encode bugs that already shipped
 * once: statuses bucketed by hard-matched words the data never contained, and half-completions
 * derived from an owner's TOTAL rather than their CLOSED count (per-agent halves summed to 11 against
 * an org total of 8).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Rows the fake db hands back, keyed by call order within fetchMaintenanceAnalytics's Promise.all. */
let queued: unknown[][] = [];
let calls = 0;

/**
 * The module issues 6 independent selects concurrently. This builder hands each `.select()` chain the
 * next queued result set, so a test declares results in the same order the module declares queries:
 * status, caseType, daily, owner, prev, full.
 */
function makeBuilder(): Record<string, unknown> {
  const chain = (idx: number): Record<string, unknown> => {
    const b: Record<string, unknown> = {};
    for (const m of ['from', 'where', 'groupBy', 'orderBy', 'limit', 'offset']) {
      b[m] = () => b;
    }
    b.then = (resolve: (v: unknown) => unknown) => Promise.resolve(queued[idx] ?? []).then(resolve);
    return b;
  };
  return { select: () => chain(calls++) };
}

vi.mock('../../src/db/client.js', () => ({ db: makeBuilder() }));

import {
  BONUS_FULL_USD,
  BONUS_HALF_USD,
  bucketStatus,
  countMaintenanceCases,
  fetchMaintenanceAnalytics,
} from '../../src/integrations/csMaintenance.js';

const WINDOW = { from: '2026-07-01', to: '2026-07-31', prevFrom: '2026-06-01', prevTo: '2026-06-30' };

beforeEach(() => {
  queued = [];
  calls = 0;
});

/** status, caseType, daily, owner, prev, full — the module's Promise.all order. */
function seed(sets: {
  status?: unknown[];
  caseType?: unknown[];
  daily?: unknown[];
  owner?: unknown[];
  prev?: number;
  full?: number;
}) {
  queued = [
    sets.status ?? [],
    sets.caseType ?? [],
    sets.daily ?? [],
    sets.owner ?? [],
    [{ n: sets.prev ?? 0 }],
    [{ n: sets.full ?? 0 }],
  ];
}

describe('bucketStatus', () => {
  it('buckets the org\'s REAL status values', () => {
    // The Deluge tested contains("progress") against "In Process" and got 0 for everything.
    expect(bucketStatus('In Process')).toBe('open');
    expect(bucketStatus('Completed')).toBe('closed');
    expect(bucketStatus('Cancelled')).toBe('cancelled');
  });

  it('stays generous so a renamed status still lands somewhere', () => {
    expect(bucketStatus('In Progress')).toBe('open');
    expect(bucketStatus('Pending review')).toBe('open');
    expect(bucketStatus('Resolved')).toBe('closed');
    expect(bucketStatus('Done')).toBe('closed');
    expect(bucketStatus('')).toBe('other');
    expect(bucketStatus('Zzz')).toBe('other');
  });
});

describe('totals', () => {
  it('buckets open/closed from the real values and sums current from byStatus', async () => {
    seed({
      status: [
        { status: 'Completed', n: 261 },
        { status: 'In Process', n: 7 },
        { status: 'Cancelled', n: 1 },
      ],
      prev: 295,
      full: 253,
    });
    const a = await fetchMaintenanceAnalytics(WINDOW);
    expect(a.totals.current).toBe(269);
    expect(a.totals.open).toBe(7);
    expect(a.totals.closed).toBe(261); // Cancelled is NOT closed
    expect(a.totals.previous).toBe(295);
    expect(a.totals.fullComplete).toBe(253);
  });

  it('labels a null status Unknown rather than dropping the group', async () => {
    seed({ status: [{ status: null, n: 4 }] });
    const a = await fetchMaintenanceAnalytics(WINDOW);
    expect(a.byStatus).toEqual([{ status: 'Unknown', count: 4 }]);
    expect(a.totals.current).toBe(4);
  });
});

describe('per-owner bonus arithmetic', () => {
  it('derives half-completions from CLOSED, not from the owner total', async () => {
    // 10 cases: 8 Completed (5 signed off) + 2 In Process (0 signed off).
    // half must be 8-5=3, NOT 10-5=5 — the bug that made per-agent halves overshoot the org total.
    seed({
      owner: [
        { ownerId: 'u1', ownerName: 'Alex Rivera', status: 'Completed', n: 8, signed: 5 },
        { ownerId: 'u1', ownerName: 'Alex Rivera', status: 'In Process', n: 2, signed: 0 },
      ],
    });
    const a = await fetchMaintenanceAnalytics(WINDOW);
    const o = a.byOwner[0]!;
    expect(o.count).toBe(10);
    expect(o.fullComplete).toBe(5);
    expect(o.halfComplete).toBe(3);
    expect(o.bonusUsd).toBe(5 * BONUS_FULL_USD + 3 * BONUS_HALF_USD);
  });

  it('floors half at 0 when a case is signed off while still open', async () => {
    // The sign-off tally is deliberately NOT status-gated, so closed - full can go negative.
    // An agent must never owe a bonus back.
    seed({
      owner: [
        { ownerId: 'u1', ownerName: 'A', status: 'Completed', n: 2, signed: 2 },
        { ownerId: 'u1', ownerName: 'A', status: 'In Process', n: 1, signed: 1 },
      ],
    });
    const a = await fetchMaintenanceAnalytics(WINDOW);
    expect(a.byOwner[0]!.fullComplete).toBe(3);
    expect(a.byOwner[0]!.halfComplete).toBe(0);
  });

  it('sums totals.halfComplete from byOwner so headline and leaderboard cannot disagree', async () => {
    seed({
      status: [{ status: 'Completed', n: 6 }],
      full: 2, // an org-wide subtraction would say 6-2=4
      owner: [
        { ownerId: 'u1', ownerName: 'A', status: 'Completed', n: 3, signed: 1 }, // half 2
        { ownerId: 'u2', ownerName: 'B', status: 'Completed', n: 3, signed: 2 }, // half 1
      ],
    });
    const a = await fetchMaintenanceAnalytics(WINDOW);
    expect(a.totals.halfComplete).toBe(3);
    expect(a.byOwner.reduce((s, o) => s + o.halfComplete, 0)).toBe(3);
  });

  it('keeps a full owner name supplied by any one status row', async () => {
    // A blank owner_name on one group must not blank the name another group provided.
    seed({
      owner: [
        { ownerId: 'u1', ownerName: null, status: 'Completed', n: 1, signed: 1 },
        { ownerId: 'u1', ownerName: 'Dana Example', status: 'In Process', n: 1, signed: 0 },
      ],
    });
    const a = await fetchMaintenanceAnalytics(WINDOW);
    expect(a.byOwner[0]!.name).toBe('Dana Example');
  });

  it('groups an owner-less case under a single "unknown" bucket', async () => {
    seed({ owner: [{ ownerId: null, ownerName: null, status: 'Completed', n: 5, signed: 5 }] });
    const a = await fetchMaintenanceAnalytics(WINDOW);
    expect(a.byOwner).toHaveLength(1);
    expect(a.byOwner[0]!.id).toBe('unknown');
    expect(a.byOwner[0]!.bonusUsd).toBe(5 * BONUS_FULL_USD);
  });

  it('rounds the bonus to cents (half rate is 2.50)', async () => {
    seed({ owner: [{ ownerId: 'u1', ownerName: 'A', status: 'Completed', n: 3, signed: 0 }] });
    const a = await fetchMaintenanceAnalytics(WINDOW);
    expect(BONUS_HALF_USD).toBe(2.5);
    expect(a.byOwner[0]!.bonusUsd).toBe(7.5);
  });
});

describe('shapes the panel consumes', () => {
  it('truncates daily days to YYYY-MM-DD and preserves query order', async () => {
    seed({ daily: [{ day: '2026-07-01', n: 3 }, { day: '2026-07-02', n: 5 }] });
    const a = await fetchMaintenanceAnalytics(WINDOW);
    expect(a.daily).toEqual([
      { day: '2026-07-01', count: 3 },
      { day: '2026-07-02', count: 5 },
    ]);
  });

  it('labels a null case type Other', async () => {
    seed({ caseType: [{ caseType: null, n: 4 }, { caseType: 'PMs', n: 9 }] });
    const a = await fetchMaintenanceAnalytics(WINDOW);
    expect(a.byCaseType).toEqual([
      { caseType: 'Other', count: 4 },
      { caseType: 'PMs', count: 9 },
    ]);
  });

  it('returns zeros rather than throwing on an empty window', async () => {
    seed({});
    const a = await fetchMaintenanceAnalytics(WINDOW);
    expect(a.totals).toEqual({
      current: 0,
      previous: 0,
      open: 0,
      closed: 0,
      fullComplete: 0,
      halfComplete: 0,
    });
    expect(a.byOwner).toEqual([]);
  });
});

describe('window validation', () => {
  it('rejects a non-YYYY-MM-DD bound', async () => {
    seed({});
    await expect(
      fetchMaintenanceAnalytics({ ...WINDOW, from: '07/01/2026' }),
    ).rejects.toThrow(/must be YYYY-MM-DD/);
  });
});

describe('countMaintenanceCases', () => {
  it('returns the windowed count for the CS Home tile', async () => {
    // The Deluge ran COUNT with no WHERE — a COQL syntax error swallowed as 0.
    queued = [[{ n: 269 }]];
    expect(await countMaintenanceCases('2026-07-01', '2026-07-31')).toBe(269);
  });

  it('returns 0 on an empty result instead of undefined', async () => {
    queued = [[]];
    expect(await countMaintenanceCases('2026-07-01', '2026-07-31')).toBe(0);
  });
});
