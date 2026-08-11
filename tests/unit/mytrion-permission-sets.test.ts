/**
 * Permission set resolution — the union semantics, in test form.
 *
 * These sets are ADDITIVE and layer on top of profile default → role default → per-user override.
 * Almost every case below exists because the opposite behaviour is a plausible reading that someone
 * will eventually "fix" it back to; the tab-defeat case in particular pins a documented consequence
 * that LOOKS like a bug.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/repos/mytrionProfileDefaultsRepo.js', () => ({
  mytrionProfileDefaultsRepo: { findByKey: vi.fn(), list: vi.fn(), upsert: vi.fn() },
}));
vi.mock('../../src/repos/mytrionRoleDefaultsRepo.js', () => ({
  mytrionRoleDefaultsRepo: { findByKey: vi.fn(), list: vi.fn(), upsert: vi.fn() },
}));
vi.mock('../../src/repos/workerMytrionAccessRepo.js', () => ({
  workerMytrionAccessRepo: { findByZohoUserId: vi.fn(), list: vi.fn(), upsert: vi.fn() },
}));
vi.mock('../../src/repos/mytrionPermissionSetsRepo.js', () => ({
  mytrionPermissionSetsRepo: { listActive: vi.fn(), list: vi.fn() },
  mytrionPermissionSetAssignmentsRepo: { listByZohoUserId: vi.fn(), listAllActive: vi.fn() },
}));

import { mytrionAccessService } from '../../src/modules/access/mytrionAccessService.js';
import { mytrionProfileDefaultsRepo } from '../../src/repos/mytrionProfileDefaultsRepo.js';
import { mytrionRoleDefaultsRepo } from '../../src/repos/mytrionRoleDefaultsRepo.js';
import { workerMytrionAccessRepo } from '../../src/repos/workerMytrionAccessRepo.js';
import {
  mytrionPermissionSetAssignmentsRepo,
  mytrionPermissionSetsRepo,
  type MytrionPermissionSetDto,
} from '../../src/repos/mytrionPermissionSetsRepo.js';
import type { MytrionId } from '../../src/lib/mytrions.js';

const pd = vi.mocked(mytrionProfileDefaultsRepo);
const rd = vi.mocked(mytrionRoleDefaultsRepo);
const wa = vi.mocked(workerMytrionAccessRepo);
const ps = vi.mocked(mytrionPermissionSetsRepo);
const psa = vi.mocked(mytrionPermissionSetAssignmentsRepo);

let seq = 0;
/** Unique principal so each assertion misses the resolver's 10s TTL cache. */
function principal(overrides: Record<string, unknown> = {}) {
  seq += 1;
  return {
    tenantId: 'octane',
    zohoUserId: `u${seq}`,
    profileName: null,
    zohoRole: null,
    userName: null,
    ...overrides,
  };
}

function set(partial: Partial<MytrionPermissionSetDto> & { id: string }): MytrionPermissionSetDto {
  return {
    name: partial.id,
    key: partial.id,
    description: null,
    allowedMytrions: [],
    mytrionAccessModes: {},
    tabGrants: {},
    active: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...partial,
  };
}

/** Give the principal these sets, all actively assigned. */
function holds(...sets: MytrionPermissionSetDto[]): void {
  ps.listActive.mockResolvedValue(sets);
  psa.listByZohoUserId.mockResolvedValue(
    sets.map((s, i) => ({
      id: `a${i}`,
      permissionSetId: s.id,
      zohoUserId: 'x',
      userName: null,
      email: null,
      active: true,
      createdAt: '2026-01-01T00:00:00.000Z',
    })),
  );
}

function profileGrants(...mytrions: MytrionId[]): void {
  pd.findByKey.mockResolvedValue({
    id: 'pd1',
    profileName: 'Standard',
    profileKey: 'standard',
    allowedMytrions: mytrions,
    homeMytrion: null,
    allDepartmentAccess: false,
    active: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  } as never);
}

beforeEach(() => {
  mytrionAccessService.invalidateAll();
  pd.findByKey.mockReset().mockResolvedValue(undefined);
  rd.findByKey.mockReset().mockResolvedValue(undefined);
  wa.findByZohoUserId.mockReset().mockResolvedValue(undefined);
  ps.listActive.mockReset().mockResolvedValue([]);
  psa.listByZohoUserId.mockReset().mockResolvedValue([]);
});

describe('permission sets union onto the existing layers', () => {
  it('adds its Mytrions to a profile default', async () => {
    profileGrants('sales');
    holds(set({ id: 's1', allowedMytrions: ['billing'] }));
    const r = await mytrionAccessService.resolveWorkerAccess(principal({ profileName: 'Standard' }));
    expect(r.accessibleMytrions.sort()).toEqual(['billing', 'sales']);
  });

  it('unions two sets, deduped', async () => {
    holds(
      set({ id: 's1', allowedMytrions: ['billing', 'hr'] }),
      set({ id: 's2', allowedMytrions: ['hr', 'finance'] }),
    );
    const r = await mytrionAccessService.resolveWorkerAccess(principal());
    expect(r.accessibleMytrions.sort()).toEqual(['billing', 'finance', 'hr']);
  });

  it('grants something to an otherwise unconfigured worker', async () => {
    // Without the `sets.length === 0` guard in combineAccess this falls to legacyAccess and the set
    // does nothing — which would make the feature invisible for the easiest people to onboard.
    holds(set({ id: 's1', allowedMytrions: ['billing'] }));
    const r = await mytrionAccessService.resolveWorkerAccess(principal());
    expect(r.accessibleMytrions).toEqual(['billing']);
  });

  it('survives a per-user override that REPLACES the allowed list', async () => {
    // Step 3.5 runs AFTER the override's replace, on purpose. Before it, "assign Bob the Billing set"
    // would silently do nothing whenever Bob had any override row at all.
    wa.findByZohoUserId.mockResolvedValue({
      allowedMytrions: ['sales'],
      deniedMytrions: [],
      allDepartmentAccess: null,
      homeMytrion: null,
      viewAsUserIds: [],
      mytrionAccessModes: {},
      active: true,
    } as never);
    holds(set({ id: 's1', allowedMytrions: ['billing'] }));
    const r = await mytrionAccessService.resolveWorkerAccess(principal());
    expect(r.accessibleMytrions.sort()).toEqual(['billing', 'sales']);
  });

  it('is still subtractable by a per-user deny', async () => {
    // Step 3.5 runs BEFORE the deny subtraction, so an admin keeps a surgical way to remove one
    // Mytrion from someone who holds it through a set.
    wa.findByZohoUserId.mockResolvedValue({
      allowedMytrions: ['sales'],
      deniedMytrions: ['billing'],
      allDepartmentAccess: null,
      homeMytrion: null,
      viewAsUserIds: [],
      mytrionAccessModes: {},
      active: true,
    } as never);
    holds(set({ id: 's1', allowedMytrions: ['billing'] }));
    const r = await mytrionAccessService.resolveWorkerAccess(principal());
    expect(r.accessibleMytrions).toEqual(['sales']);
  });

  it('ignores an inactive set and an assignment pointing at a deleted one', async () => {
    // No foreign keys (house rule), so both are real states an orphan can reach.
    ps.listActive.mockResolvedValue([set({ id: 'live', allowedMytrions: ['hr'] })]);
    psa.listByZohoUserId.mockResolvedValue([
      { id: 'a1', permissionSetId: 'live', zohoUserId: 'x', userName: null, email: null, active: true, createdAt: '' },
      { id: 'a2', permissionSetId: 'deleted', zohoUserId: 'x', userName: null, email: null, active: true, createdAt: '' },
    ]);
    const r = await mytrionAccessService.resolveWorkerAccess(principal());
    expect(r.accessibleMytrions).toEqual(['hr']);
  });

  it('cannot confer all-department access', async () => {
    // There is no column for it, deliberately: one edit would escalate every holder past the
    // LAST_ADMIN rail, which only guards the explicit per-user path.
    holds(set({ id: 's1', allowedMytrions: ['billing', 'hr', 'sales'] }));
    const r = await mytrionAccessService.resolveWorkerAccess(principal());
    expect(r.allDepartmentAccess).toBe(false);
  });
});

describe('read/full — most permissive wins', () => {
  it('lets one set upgrade another set to full', async () => {
    holds(
      set({ id: 's1', allowedMytrions: ['billing'], mytrionAccessModes: { billing: 'read' } }),
      set({ id: 's2', allowedMytrions: ['billing'], mytrionAccessModes: { billing: 'full' } }),
    );
    const r = await mytrionAccessService.resolveWorkerAccess(principal());
    expect(r.mytrionAccessModes.billing).toBe('full');
  });

  it("lets a set's explicit full beat a per-user read", async () => {
    // THE decision, in test form. The alternative (per-user wins) makes assigning a Full set a
    // silent no-op with no feedback anywhere; to restrict someone you remove the set from them.
    wa.findByZohoUserId.mockResolvedValue({
      allowedMytrions: ['billing'],
      deniedMytrions: [],
      allDepartmentAccess: null,
      homeMytrion: null,
      viewAsUserIds: [],
      mytrionAccessModes: { billing: 'read' },
      active: true,
    } as never);
    holds(set({ id: 's1', allowedMytrions: ['billing'], mytrionAccessModes: { billing: 'full' } }));
    const r = await mytrionAccessService.resolveWorkerAccess(principal());
    expect(r.mytrionAccessModes.billing).toBe('full');
  });

  it('does NOT let a set read LOWER a mode another layer already implies', async () => {
    /**
     * Additive means a set may raise a mode and never lower one.
     *
     * Profile defaults have no mode column, so a Mytrion they grant is implicitly FULL. Consulting
     * the set's `read` unconditionally meant assigning a read-only set to someone who already had
     * Billing REVOKED their write access — the exact opposite of what an additive grant may do.
     */
    profileGrants('billing');
    holds(set({ id: 's1', allowedMytrions: ['billing'], mytrionAccessModes: { billing: 'read' } }));
    const r = await mytrionAccessService.resolveWorkerAccess(principal({ profileName: 'Standard' }));
    expect(r.mytrionAccessModes.billing).toBe('full');
  });

  it('DOES apply a set read when the set is the only source of the grant', async () => {
    // The set granted it, so the set gets to say how. Nothing is being lowered.
    holds(set({ id: 's1', allowedMytrions: ['billing'], mytrionAccessModes: { billing: 'read' } }));
    const r = await mytrionAccessService.resolveWorkerAccess(principal());
    expect(r.mytrionAccessModes.billing).toBe('read');
  });

  it('degrades strictly NARROWER when the permission-set read fails', async () => {
    /**
     * The hazard the rule above also closes.
     *
     * When a set's `read` had been lowering an implicit full, a fail-soft read would spring the mode
     * back to `full` — so a transient database problem ESCALATED a read-only user to write. Now the
     * healthy and failed answers agree, because the set was never setting the mode to begin with.
     */
    profileGrants('billing');
    holds(set({ id: 's1', allowedMytrions: ['billing'], mytrionAccessModes: { billing: 'read' } }));
    const healthy = await mytrionAccessService.resolveWorkerAccess(principal({ profileName: 'Standard' }));

    mytrionAccessService.invalidateAll();
    ps.listActive.mockRejectedValue(new Error('relation does not exist'));
    psa.listByZohoUserId.mockRejectedValue(new Error('relation does not exist'));
    const failed = await mytrionAccessService.resolveWorkerAccess(principal({ profileName: 'Standard' }));

    expect(failed.mytrionAccessModes.billing).toBe(healthy.mytrionAccessModes.billing);
    expect(failed.mytrionAccessModes.billing).toBe('full');
  });

  it("keeps a per-user read when the set only says read", async () => {
    wa.findByZohoUserId.mockResolvedValue({
      allowedMytrions: [],
      deniedMytrions: [],
      allDepartmentAccess: null,
      homeMytrion: null,
      viewAsUserIds: [],
      mytrionAccessModes: { billing: 'read' },
      active: true,
    } as never);
    holds(set({ id: 's1', allowedMytrions: ['billing'], mytrionAccessModes: { billing: 'read' } }));
    const r = await mytrionAccessService.resolveWorkerAccess(principal());
    expect(r.mytrionAccessModes.billing).toBe('read');
  });
});

describe('tab grants', () => {
  it('leaves a Mytrion UNSCOPED when the set names no tabs', async () => {
    // The rollout default, and the reason a new tab does not silently vanish for everyone: absent
    // means "every tab, including ones added later".
    holds(set({ id: 's1', allowedMytrions: ['billing'] }));
    const r = await mytrionAccessService.resolveWorkerAccess(principal());
    expect(r.mytrionTabGrants.billing).toBeUndefined();
  });

  it('unions the tab lists of two scoped sets', async () => {
    holds(
      set({ id: 's1', allowedMytrions: ['billing'], tabGrants: { billing: ['ledger'] } }),
      set({ id: 's2', allowedMytrions: ['billing'], tabGrants: { billing: ['debtors'] } }),
    );
    const r = await mytrionAccessService.resolveWorkerAccess(principal());
    expect(r.mytrionTabGrants.billing?.sort()).toEqual(['debtors', 'ledger']);
  });

  it('honours an EMPTY scope as "no tabs", not as "unscoped"', async () => {
    holds(set({ id: 's1', allowedMytrions: ['billing'], tabGrants: { billing: [] } }));
    const r = await mytrionAccessService.resolveWorkerAccess(principal());
    expect(r.mytrionTabGrants.billing).toEqual([]);
  });

  it('is DEFEATED by an unscoped grant of the same Mytrion from another layer', async () => {
    /**
     * The documented gotcha, pinned so nobody "fixes" it into an intersection.
     *
     * A profile default grants Billing with no tab scope — it has no tab column and never can — so
     * the union of scopes for Billing is unscoped and every tab renders. The admin provenance view
     * says this in words and offers to narrow the user; the alternative semantics reintroduce the
     * non-expressible "everything except X" trap that enforceableAllDept already works around.
     */
    profileGrants('billing');
    holds(set({ id: 's1', allowedMytrions: ['billing'], tabGrants: { billing: ['ledger'] } }));
    const r = await mytrionAccessService.resolveWorkerAccess(principal({ profileName: 'Standard' }));
    expect(r.accessibleMytrions).toContain('billing');
    expect(r.mytrionTabGrants.billing).toBeUndefined();
  });

  it('drops a scope for a Mytrion the worker cannot enter', async () => {
    wa.findByZohoUserId.mockResolvedValue({
      allowedMytrions: [],
      deniedMytrions: ['billing'],
      allDepartmentAccess: null,
      homeMytrion: null,
      viewAsUserIds: [],
      mytrionAccessModes: {},
      active: true,
    } as never);
    holds(
      set({
        id: 's1',
        allowedMytrions: ['billing', 'hr'],
        tabGrants: { billing: ['ledger'], hr: ['home'] },
      }),
    );
    const r = await mytrionAccessService.resolveWorkerAccess(principal());
    expect(r.mytrionTabGrants.billing).toBeUndefined();
    expect(r.mytrionTabGrants.hr).toEqual(['home']);
  });

  it('clears every scope for an all-access admin even when one Mytrion is DENIED', async () => {
    // The deny downgrades `enforceableAllDept` so the Mytrion deny enforces — it must not also turn
    // on tab scoping for someone who was granted everything.
    wa.findByZohoUserId.mockResolvedValue({
      allowedMytrions: null, deniedMytrions: ['hr'], allDepartmentAccess: null, homeMytrion: null,
      viewAsUserIds: [], mytrionAccessModes: {}, active: true,
    } as never);
    holds(set({ id: 's1', allowedMytrions: ['billing'], tabGrants: { billing: ['ledger'] } }));
    const r = await mytrionAccessService.resolveWorkerAccess(principal({ profileName: 'Administrator' }));
    expect(r.accessibleMytrions).not.toContain('hr');
    expect(r.mytrionTabGrants).toEqual({});
  });

  it('clears every scope for an all-access admin', async () => {
    // All-access means all tabs. Leaving stale scoping on an admin is a support ticket.
    holds(set({ id: 's1', allowedMytrions: ['billing'], tabGrants: { billing: ['ledger'] } }));
    const r = await mytrionAccessService.resolveWorkerAccess(
      principal({ profileName: 'Administrator' }),
    );
    expect(r.allDepartmentAccess).toBe(true);
    expect(r.mytrionTabGrants).toEqual({});
  });
});

describe('resolveBatch matches the per-user path', () => {
  it('produces identical output for a fixture including sets', async () => {
    // The two paths sharing combineAccess is the entire point of keeping it pure.
    const s = set({
      id: 's1',
      allowedMytrions: ['billing'],
      mytrionAccessModes: { billing: 'read' },
      tabGrants: { billing: ['ledger'] },
    });
    ps.listActive.mockResolvedValue([s]);
    psa.listByZohoUserId.mockResolvedValue([
      { id: 'a1', permissionSetId: 's1', zohoUserId: 'batch-1', userName: null, email: null, active: true, createdAt: '' },
    ]);
    psa.listAllActive.mockResolvedValue([
      { id: 'a1', permissionSetId: 's1', zohoUserId: 'batch-1', userName: null, email: null, active: true, createdAt: '' },
    ]);
    pd.list.mockResolvedValue([]);
    rd.list.mockResolvedValue([]);
    wa.list.mockResolvedValue([]);

    const input = {
      tenantId: 'octane',
      zohoUserId: 'batch-1',
      profileName: null,
      zohoRole: null,
      userName: null,
    };
    const single = await mytrionAccessService.resolveWorkerAccess(input);
    mytrionAccessService.invalidateAll();
    const batch = await mytrionAccessService.resolveBatch('octane', [input]);
    expect(batch.get('batch-1')).toEqual(single);
  });
});

describe('permission-set reads fail soft', () => {
  it('keeps the other layers when the tables are unreachable', async () => {
    /**
     * The realistic failure is deploying this code before running migration 0114.
     *
     * These two queries are unconditional, unlike the other three in computeAccess, so sharing the
     * outer catch would degrade EVERY user to `legacyAccess` — which grants far less and by design
     * never grants Customer Service. Access would collapse org-wide and the log would say "resolve
     * failed" rather than "the new tables are missing". Sets are additive, so resolving without them
     * is a correct, strictly-narrower answer; losing the whole grant chain is not.
     */
    profileGrants('billing', 'customer-service');
    ps.listActive.mockRejectedValue(new Error('relation "mytrion_permission_sets" does not exist'));
    psa.listByZohoUserId.mockRejectedValue(new Error('relation does not exist'));

    const r = await mytrionAccessService.resolveWorkerAccess(principal({ profileName: 'Standard' }));
    expect(r.accessibleMytrions.sort()).toEqual(['billing', 'customer-service']);
    expect(r.mytrionTabGrants).toEqual({});
  });
});

describe('explain() provenance', () => {
  it('names the layer whose unscoped grant DEFEATED a set scope', async () => {
    /**
     * The reason the trace exists.
     *
     * "I scoped them to Ledger and they still see everything" is unanswerable without this: profile
     * defaults have no tab column, so there is nothing for an admin to look at that would explain it.
     */
    profileGrants('billing');
    holds(set({ id: 's1', name: 'Billing — Ledger only', allowedMytrions: ['billing'], tabGrants: { billing: ['ledger'] } }));
    const { trace } = await mytrionAccessService.explain(principal({ profileName: 'Standard' }));
    const billing = trace?.mytrions.find((m) => m.mytrion === 'billing');
    expect(billing?.tabs.scoped).toBe(false);
    expect(billing?.tabs.unscopedBy?.layer).toBe('profile');
    expect(billing?.tabs.unscopedBy?.label).toContain('Standard');
  });

  it('lists every layer that granted a Mytrion', async () => {
    profileGrants('billing');
    holds(set({ id: 's1', name: 'Billing Ops', allowedMytrions: ['billing'] }));
    const { trace } = await mytrionAccessService.explain(principal({ profileName: 'Standard' }));
    const layers = trace?.mytrions.find((m) => m.mytrion === 'billing')?.grantedBy.map((g) => g.layer);
    expect(layers).toContain('profile');
    expect(layers).toContain('permission_set');
  });

  it('attributes the MODE to the layer resolveModes actually used', async () => {
    holds(set({ id: 's1', name: 'Billing Full Ops', allowedMytrions: ['billing'], mytrionAccessModes: { billing: 'full' } }));
    wa.findByZohoUserId.mockResolvedValue({
      allowedMytrions: ['billing'], deniedMytrions: [], allDepartmentAccess: null, homeMytrion: null,
      viewAsUserIds: [], mytrionAccessModes: { billing: 'read' }, active: true,
    } as never);
    const { access, trace } = await mytrionAccessService.explain(principal());
    const billing = trace?.mytrions.find((m) => m.mytrion === 'billing');
    // The gate and the explanation must never disagree — they read the same computed value.
    expect(billing?.mode).toBe(access.mytrionAccessModes.billing);
    expect(billing?.mode).toBe('full');
    expect(billing?.modeFrom.layer).toBe('permission_set');
  });

  it('reports a scope that DID survive', async () => {
    holds(set({ id: 's1', allowedMytrions: ['billing'], tabGrants: { billing: ['ledger'] } }));
    const { trace } = await mytrionAccessService.explain(principal());
    const billing = trace?.mytrions.find((m) => m.mytrion === 'billing');
    expect(billing?.tabs.scoped).toBe(true);
    expect(billing?.tabs.keys).toEqual(['ledger']);
    expect(billing?.tabs.unscopedBy).toBeUndefined();
  });
});
