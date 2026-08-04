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
 * The module issues 5 independent selects concurrently. This builder hands each `.select()` chain the
 * next queued result set, so a test declares results in the same order the module declares queries:
 * status, caseType, daily, owner, prev. (There used to be a 6th, `full` — an org-wide count of
 * signed-off cases — but it's gone: `totals.fullComplete` is now accumulated inside the same loop
 * that reads `owner`, so it can't disagree with the per-owner gate. See csMaintenance.ts.)
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

import { PgDialect, QueryBuilder } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { maintenanceCases } from '../../src/db/schema/index.js';
import {
  BONUS_FULL_USD,
  BONUS_HALF_USD,
  bucketStatus,
  countMaintenanceCases,
  fetchMaintenanceAnalytics,
  SECOND_ID_SQL,
  SECOND_NAME_SQL,
} from '../../src/integrations/csMaintenance.js';

const WINDOW = { from: '2026-07-01', to: '2026-07-31', prevFrom: '2026-06-01', prevTo: '2026-06-30' };

beforeEach(() => {
  queued = [];
  calls = 0;
});

/** status, caseType, daily, owner, prev — the module's Promise.all order. */
function seed(sets: {
  status?: unknown[];
  caseType?: unknown[];
  daily?: unknown[];
  owner?: unknown[];
  prev?: number;
}) {
  queued = [
    sets.status ?? [],
    sets.caseType ?? [],
    sets.daily ?? [],
    sets.owner ?? [],
    [{ n: sets.prev ?? 0 }],
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
      // fullComplete is no longer a separate query — it's accumulated from the SAME owner rows
      // the leaderboard reads, gated the same way (see 'per-owner bonus arithmetic' below). 253 of
      // the 261 Completed cases were signed off; none of the 7 In Process or 1 Cancelled were.
      owner: [
        { ownerId: 'u1', ownerName: 'A', status: 'Completed', n: 261, signed: 253 },
        { ownerId: 'u1', ownerName: 'A', status: 'In Process', n: 7, signed: 0 },
        { ownerId: 'u1', ownerName: 'A', status: 'Cancelled', n: 1, signed: 0 },
      ],
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

describe('the Cancelled bonus bug (fixed, CS feedback 2026-07-31)', () => {
  it('a Cancelled case with a completion date earns nothing, even though it is "signed"', async () => {
    seed({
      owner: [{ ownerId: 'u1', ownerName: 'A', status: 'Cancelled', n: 1, signed: 1 }],
    });
    const a = await fetchMaintenanceAnalytics(WINDOW);
    expect(a.byOwner[0]!.fullComplete).toBe(0);
    expect(a.byOwner[0]!.halfComplete).toBe(0);
    expect(a.byOwner[0]!.bonusUsd).toBe(0);
    expect(a.totals.fullComplete).toBe(0);
  });

  it('does not swallow a real bonus on the same owner in the same window', async () => {
    // One legitimate Completed+signed case alongside the Cancelled+signed one above — the fix must
    // gate the Cancelled row specifically, not the owner or the window.
    seed({
      owner: [
        { ownerId: 'u1', ownerName: 'A', status: 'Cancelled', n: 1, signed: 1 },
        { ownerId: 'u1', ownerName: 'A', status: 'Completed', n: 1, signed: 1 },
      ],
    });
    const a = await fetchMaintenanceAnalytics(WINDOW);
    expect(a.byOwner[0]!.fullComplete).toBe(1);
    expect(a.byOwner[0]!.bonusUsd).toBe(BONUS_FULL_USD);
  });
});

describe('second agent — 50/50 bonus split (CS feedback 2026-07-31)', () => {
  it('splits a full-complete case evenly between owner and second agent', async () => {
    seed({
      owner: [
        {
          ownerId: 'u1', ownerName: 'Owner', status: 'Completed', n: 1, signed: 1,
          secondId: 'u2', secondName: 'Second',
        },
      ],
    });
    const a = await fetchMaintenanceAnalytics(WINDOW);
    expect(a.byOwner).toHaveLength(2);
    for (const o of a.byOwner) {
      expect(o.count).toBe(0.5);
      expect(o.fullComplete).toBe(0.5);
      expect(o.halfComplete).toBe(0);
      expect(o.bonusUsd).toBe(2.5);
    }
    // Org-wide, the case still counts as exactly one — only the per-agent attribution is fractional.
    expect(a.totals.fullComplete).toBe(1);
  });

  it('splits a half-complete case evenly', async () => {
    seed({
      owner: [
        {
          ownerId: 'u1', ownerName: 'Owner', status: 'Completed', n: 1, signed: 0,
          secondId: 'u2', secondName: 'Second',
        },
      ],
    });
    const a = await fetchMaintenanceAnalytics(WINDOW);
    for (const o of a.byOwner) {
      expect(o.halfComplete).toBe(0.5);
      expect(o.fullComplete).toBe(0);
      expect(o.bonusUsd).toBe(1.25);
    }
  });

  it('a jointly-worked Cancelled case earns neither agent anything, but count still splits', async () => {
    seed({
      owner: [
        {
          ownerId: 'u1', ownerName: 'Owner', status: 'Cancelled', n: 1, signed: 1,
          secondId: 'u2', secondName: 'Second',
        },
      ],
    });
    const a = await fetchMaintenanceAnalytics(WINDOW);
    for (const o of a.byOwner) {
      expect(o.fullComplete).toBe(0);
      expect(o.halfComplete).toBe(0);
      expect(o.bonusUsd).toBe(0);
      expect(o.count).toBe(0.5);
    }
  });

  it('a jointly-worked case still In Process but signed off gives BOTH agents full credit — the exact ' +
    'case a naive two-pass split (gated on the closed bucket only) would get wrong', async () => {
    seed({
      owner: [
        {
          ownerId: 'u1', ownerName: 'Owner', status: 'In Process', n: 1, signed: 1,
          secondId: 'u2', secondName: 'Second',
        },
      ],
    });
    const a = await fetchMaintenanceAnalytics(WINDOW);
    for (const o of a.byOwner) {
      expect(o.fullComplete).toBe(0.5);
      expect(o.bonusUsd).toBe(2.5);
    }
  });

  it('a second agent identical to the owner is a no-op — no split, integral values', async () => {
    seed({
      owner: [
        {
          ownerId: 'u1', ownerName: 'Owner', status: 'Completed', n: 4, signed: 4,
          secondId: 'u1', secondName: 'Owner',
        },
      ],
    });
    const a = await fetchMaintenanceAnalytics(WINDOW);
    expect(a.byOwner).toHaveLength(1);
    expect(a.byOwner[0]!.fullComplete).toBe(4);
    expect(a.byOwner[0]!.bonusUsd).toBe(20);
  });

  it('a null owner with a real second agent still splits — null-safe, unlike SQL `<>`', async () => {
    seed({
      owner: [
        {
          ownerId: null, ownerName: null, status: 'Completed', n: 1, signed: 1,
          secondId: 'u2', secondName: 'Second',
        },
      ],
    });
    const a = await fetchMaintenanceAnalytics(WINDOW);
    const unknown = a.byOwner.find((o) => o.id === 'unknown')!;
    const second = a.byOwner.find((o) => o.id === 'u2')!;
    expect(unknown.fullComplete).toBe(0.5);
    expect(second.fullComplete).toBe(0.5);
    expect(second.name).toBe('Second');
  });

  it('a second agent with no other cases of their own still appears, named from secondName', async () => {
    seed({
      owner: [
        {
          ownerId: 'u1', ownerName: 'Owner', status: 'Completed', n: 1, signed: 1,
          secondId: 'brand-new-agent', secondName: 'Fresh Face',
        },
      ],
    });
    const a = await fetchMaintenanceAnalytics(WINDOW);
    const second = a.byOwner.find((o) => o.id === 'brand-new-agent')!;
    expect(second).toBeDefined();
    expect(second.name).toBe('Fresh Face');
    expect(second.fullComplete).toBe(0.5);
  });

  it('preserves sum(byOwner.count) === totals.current even with a joint row', async () => {
    seed({
      status: [{ status: 'Completed', n: 3 }],
      owner: [
        { ownerId: 'u1', ownerName: 'A', status: 'Completed', n: 2, signed: 2 },
        {
          ownerId: 'u3', ownerName: 'C', status: 'Completed', n: 1, signed: 1,
          secondId: 'u4', secondName: 'D',
        },
      ],
    });
    const a = await fetchMaintenanceAnalytics(WINDOW);
    const total = a.byOwner.reduce((s, o) => s + o.count, 0);
    expect(total).toBe(a.totals.current);
    expect(total).toBe(3);
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

/**
 * The leaderboard's second-agent columns sit in BOTH the projection and the GROUP BY, and Postgres
 * only accepts that when the two render as the same expression.
 *
 * This is the one thing the mocked `db` above cannot check — it makes `groupBy` a no-op passthrough
 * and never renders SQL — and it is exactly what broke: built with drizzle's `sql` template, the same
 * expression came out qualified differently and with a fresh bind placeholder in each position, so
 * the whole Analytics → Maintenance tab died on
 * `42803: column "maintenance_cases.case_date" must appear in the GROUP BY clause`.
 *
 * These render the real query through `PgDialect` (no connection needed) and assert the property that
 * actually matters: the grouped expression is byte-identical to the projected one.
 */
describe('the second-agent expressions survive a GROUP BY', () => {
  const dialect = new PgDialect();
  const render = (q: { getSQL: () => Parameters<PgDialect['sqlToQuery']>[0] }) =>
    dialect.sqlToQuery(q.getSQL());

  /** The leaderboard query as csMaintenance builds it, minus the WHERE (not what is under test). */
  function ownerQuery() {
    const secondId = sql.raw(SECOND_ID_SQL);
    const secondName = sql.raw(SECOND_NAME_SQL);
    return new QueryBuilder()
      .select({
        ownerId: maintenanceCases.ownerZohoUserId,
        status: maintenanceCases.status,
        secondId,
        secondName,
        n: sql<number>`count(*)::int`,
      })
      .from(maintenanceCases)
      .groupBy(maintenanceCases.ownerZohoUserId, maintenanceCases.status, secondId, secondName);
  }

  it('renders the CASE identically in the projection and the GROUP BY', () => {
    const { sql: text } = render(ownerQuery());
    const [projection, grouped] = text.split(/group by/i);
    for (const expr of [SECOND_ID_SQL, SECOND_NAME_SQL]) {
      expect(projection, 'projection should contain the raw CASE').toContain(expr);
      expect(grouped, 'GROUP BY should contain the SAME text').toContain(expr);
    }
  });

  it('carries no bind parameters, so no placeholder can be renumbered between positions', () => {
    // The renumbering ($1 in the projection vs $5 in the GROUP BY) was half of the original bug.
    expect(SECOND_ID_SQL).not.toMatch(/\$\d/);
    expect(SECOND_NAME_SQL).not.toMatch(/\$\d/);
    const { params } = render(ownerQuery());
    expect(params).toHaveLength(0);
  });

  it('qualifies its columns, so the two positions cannot disagree on qualification', () => {
    // The other half: drizzle emitted a bare "case_date" in the projection and
    // "maintenance_cases"."case_date" in the GROUP BY.
    for (const expr of [SECOND_ID_SQL, SECOND_NAME_SQL]) {
      expect(expr).toContain('maintenance_cases.case_date');
      expect(expr).toContain("date '2026-08-01'");
    }
    expect(SECOND_ID_SQL).toContain('maintenance_cases.bonus_completion_user_id');
    expect(SECOND_NAME_SQL).toContain('maintenance_cases.bonus_completion_name');
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
