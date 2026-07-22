/**
 * mytrionAccessService.resolveWorkerAccess — the single authority for a worker's Mytrion access.
 * The two access repos are mocked (no DB): these tests pin the RESOLUTION rules — profile default,
 * per-user replace/deny, home selection, the env-admin lockout floor, and fail-open-to-legacy on a
 * DB error. Distinct (tenant, zohoUserId) per case dodges the 60s resolver cache.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/repos/mytrionProfileDefaultsRepo.js', () => ({
  mytrionProfileDefaultsRepo: { findByKey: vi.fn(), list: vi.fn(), upsert: vi.fn() },
}));
vi.mock('../../src/repos/workerMytrionAccessRepo.js', () => ({
  workerMytrionAccessRepo: { findByZohoUserId: vi.fn(), list: vi.fn(), upsert: vi.fn() },
}));

import { mytrionAccessService } from '../../src/modules/access/mytrionAccessService.js';
import { MYTRION_IDS } from '../../src/lib/mytrions.js';
import { mytrionProfileDefaultsRepo } from '../../src/repos/mytrionProfileDefaultsRepo.js';
import { workerMytrionAccessRepo } from '../../src/repos/workerMytrionAccessRepo.js';

const pd = vi.mocked(mytrionProfileDefaultsRepo);
const wa = vi.mocked(workerMytrionAccessRepo);

let seq = 0;
/** Unique principal so each assertion misses the resolver's TTL cache. */
function principal(overrides: Record<string, unknown> = {}) {
  seq += 1;
  return { tenantId: 'octane', zohoUserId: `u${seq}`, profileName: null, zohoRole: null, userName: null, ...overrides };
}

beforeEach(() => {
  mytrionAccessService.invalidateAll();
  pd.findByKey.mockReset().mockResolvedValue(undefined);
  wa.findByZohoUserId.mockReset().mockResolvedValue(undefined);
});

function profileDefault(over: Record<string, unknown> = {}) {
  return {
    id: 'pd_x',
    profileName: 'X',
    profileKey: 'x',
    allowedMytrions: [],
    homeMytrion: null,
    allDepartmentAccess: false,
    active: true,
    createdAt: '',
    updatedAt: '',
    ...over,
  };
}
function override(over: Record<string, unknown> = {}) {
  return {
    id: 'wma_x',
    zohoUserId: 'u',
    userName: null,
    email: null,
    profileName: null,
    allowedMytrions: null,
    deniedMytrions: [],
    homeMytrion: null,
    allDepartmentAccess: null,
    viewAsUserIds: [],
    active: true,
    createdAt: '',
    updatedAt: '',
    ...over,
  };
}

describe('resolveWorkerAccess — profile defaults', () => {
  it('grants exactly the profile default set + home, no override', async () => {
    pd.findByKey.mockResolvedValue(profileDefault({ allowedMytrions: ['sales'], homeMytrion: 'sales' }));
    const r = await mytrionAccessService.resolveWorkerAccess(principal({ profileName: 'Sales Agent' }));
    expect(r.accessibleMytrions).toEqual(['sales']);
    expect(r.homeMytrion).toBe('sales');
    expect(r.allDepartmentAccess).toBe(false);
    expect(r.departments).toEqual(['sales']);
  });

  it('unknown profile ⇒ fail-closed (no access) for a non-admin', async () => {
    const r = await mytrionAccessService.resolveWorkerAccess(principal({ profileName: 'Mystery' }));
    expect(r.accessibleMytrions).toEqual([]);
    expect(r.allDepartmentAccess).toBe(false);
    expect(r.homeMytrion).toBeNull();
  });
});

describe('resolveWorkerAccess — per-user overrides', () => {
  it('non-null allowedMytrions REPLACES the profile default set', async () => {
    pd.findByKey.mockResolvedValue(profileDefault({ allowedMytrions: ['sales'] }));
    wa.findByZohoUserId.mockResolvedValue(override({ allowedMytrions: ['billing', 'finance'] }));
    const r = await mytrionAccessService.resolveWorkerAccess(principal({ profileName: 'Sales Agent' }));
    expect(r.accessibleMytrions.sort()).toEqual(['billing', 'finance']);
    expect(r.departments.sort()).toEqual(['billing', 'finance']);
  });

  it('null allowedMytrions INHERITS the profile default; deniedMytrions subtracts last', async () => {
    pd.findByKey.mockResolvedValue(profileDefault({ allowedMytrions: ['sales', 'billing'] }));
    wa.findByZohoUserId.mockResolvedValue(override({ allowedMytrions: null, deniedMytrions: ['billing'] }));
    const r = await mytrionAccessService.resolveWorkerAccess(principal({ profileName: 'Standard Plus' }));
    expect(r.accessibleMytrions).toEqual(['sales']);
  });

  it('per-user allDepartmentAccess:true grants everything (departments bypassed → [])', async () => {
    wa.findByZohoUserId.mockResolvedValue(override({ allDepartmentAccess: true }));
    const r = await mytrionAccessService.resolveWorkerAccess(principal({ profileName: 'Standard' }));
    expect(r.allDepartmentAccess).toBe(true);
    expect(r.accessibleMytrions.length).toBe(MYTRION_IDS.length);
    expect(r.departments).toEqual([]);
  });

  it('home falls back to the sole accessible Mytrion when the configured home is not granted', async () => {
    pd.findByKey.mockResolvedValue(profileDefault({ allowedMytrions: ['billing'], homeMytrion: 'sales' }));
    const r = await mytrionAccessService.resolveWorkerAccess(principal({ profileName: 'Billing' }));
    expect(r.homeMytrion).toBe('billing'); // 'sales' not granted → sole accessible wins
  });
});

describe('resolveWorkerAccess — admin lockout floor (env-marker admins can never be stripped)', () => {
  it('an Administrator profile is pinned to all-access even if a DB override says false', async () => {
    wa.findByZohoUserId.mockResolvedValue(override({ allDepartmentAccess: false, allowedMytrions: ['sales'] }));
    const r = await mytrionAccessService.resolveWorkerAccess(
      principal({ profileName: 'Administrator', userName: 'Ann' }),
    );
    expect(r.allDepartmentAccess).toBe(true); // env-admin floor — DB cannot lower it
    expect(r.accessibleMytrions.length).toBe(MYTRION_IDS.length);
  });

  it('a denied list is IGNORED for an env-admin (no-lockout: their Mytrion list is never emptied)', async () => {
    wa.findByZohoUserId.mockResolvedValue(override({ deniedMytrions: ['finance'] }));
    const r = await mytrionAccessService.resolveWorkerAccess(principal({ profileName: 'Administrator' }));
    expect(r.allDepartmentAccess).toBe(true);
    // env-marker admins are exempt from the deny-list, so the full set stays visible
    expect(r.accessibleMytrions).toContain('finance');
    expect(r.accessibleMytrions.length).toBe(MYTRION_IDS.length);
  });
});

describe('resolveWorkerAccess — deny enforcement + inherit floor (review hardening)', () => {
  it('a non-admin all-access grant WITH denies downgrades to explicit departments so the deny enforces', async () => {
    pd.findByKey.mockResolvedValue(profileDefault({ allDepartmentAccess: true }));
    wa.findByZohoUserId.mockResolvedValue(override({ deniedMytrions: ['finance'] }));
    const r = await mytrionAccessService.resolveWorkerAccess(principal({ profileName: 'Ops Lead' }));
    // allDepartmentAccess=true is a full bypass, so a denied all-access is downgraded to a real
    // department grant — otherwise the deny would be invisible to the backend gates.
    expect(r.allDepartmentAccess).toBe(false);
    expect(r.accessibleMytrions).not.toContain('finance');
    expect(r.departments).not.toContain('finance');
    expect(r.departments.length).toBeGreaterThan(0);
  });

  it('an override that inherits with NO profile default falls back to the legacy floor (not empty)', async () => {
    // profile default not seeded yet; the override inherits (allowedMytrions=null).
    wa.findByZohoUserId.mockResolvedValue(override({ allowedMytrions: null }));
    const r = await mytrionAccessService.resolveWorkerAccess(
      principal({ profileName: 'Sales Rep', zohoRole: 'Sales Agent' }),
    );
    expect(r.accessibleMytrions).toContain('sales'); // legacy floor, not []
  });
});

describe('resolveWorkerAccess — fail-open-to-legacy on DB error', () => {
  it('a non-admin falls back to profile→department derivation (never total lockout)', async () => {
    pd.findByKey.mockRejectedValue(new Error('db down'));
    const r = await mytrionAccessService.resolveWorkerAccess(
      principal({ profileName: 'Sales Rep', zohoRole: 'Sales Agent' }),
    );
    expect(r.allDepartmentAccess).toBe(false);
    expect(r.departments).toContain('sales'); // deriveWorkerDepartments fallback
  });

  it('an env-admin stays all-access even when the DB is down', async () => {
    pd.findByKey.mockRejectedValue(new Error('db down'));
    const r = await mytrionAccessService.resolveWorkerAccess(principal({ profileName: 'Administrator' }));
    expect(r.allDepartmentAccess).toBe(true);
    expect(r.accessibleMytrions.length).toBe(MYTRION_IDS.length);
  });
});

describe('resolveWorkerAccess — tenant scoping', () => {
  it('queries both access repos with the caller tenant id', async () => {
    await mytrionAccessService.resolveWorkerAccess(principal({ tenantId: 'octane', profileName: 'Sales Agent' }));
    expect(pd.findByKey).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'octane' }), 'sales agent');
    expect(wa.findByZohoUserId).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'octane' }),
      expect.any(String),
    );
  });
});
