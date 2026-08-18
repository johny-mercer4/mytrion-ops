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
vi.mock('../../src/repos/mytrionRoleDefaultsRepo.js', () => ({
  mytrionRoleDefaultsRepo: { findByKey: vi.fn(), list: vi.fn(), upsert: vi.fn() },
}));
vi.mock('../../src/repos/mytrionPermissionSetsRepo.js', () => ({
  // Added with permission sets. Without these the REAL repos reach `db`, computeAccess catches, and
  // every case in this file silently degrades to `legacyAccess` — the assertions then fail with
  // baffling wrong grants rather than a clear connection error.
  mytrionPermissionSetsRepo: { listActive: vi.fn(async () => []), list: vi.fn(async () => []) },
  mytrionPermissionSetAssignmentsRepo: {
    listByZohoUserId: vi.fn(async () => []),
    listAllActive: vi.fn(async () => []),
  },
}));
vi.mock('../../src/repos/workerMytrionAccessRepo.js', () => ({
  workerMytrionAccessRepo: { findByZohoUserId: vi.fn(), list: vi.fn(), upsert: vi.fn() },
}));

import { mytrionAccessService } from '../../src/modules/access/mytrionAccessService.js';
import { MYTRION_IDS } from '../../src/lib/mytrions.js';
import { mytrionProfileDefaultsRepo } from '../../src/repos/mytrionProfileDefaultsRepo.js';
import { mytrionRoleDefaultsRepo } from '../../src/repos/mytrionRoleDefaultsRepo.js';
import { workerMytrionAccessRepo } from '../../src/repos/workerMytrionAccessRepo.js';

const pd = vi.mocked(mytrionProfileDefaultsRepo);
const rd = vi.mocked(mytrionRoleDefaultsRepo);
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
  rd.findByKey.mockReset().mockResolvedValue(undefined);
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
function roleDefault(over: Record<string, unknown> = {}) {
  return {
    id: 'rd_x',
    roleName: 'X',
    roleKey: 'x',
    allowedMytrions: [],
    homeMytrion: null,
    allDepartmentAccess: false,
    mytrionAccessModes: {},
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
    mytrionAccessModes: {},
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

describe('resolveWorkerAccess — role defaults', () => {
  it('role-only grant: particular Mytrion = full access + auto-route home', async () => {
    rd.findByKey.mockResolvedValue(
      roleDefault({
        roleName: 'Ops Specialist',
        roleKey: 'ops specialist',
        allowedMytrions: ['billing'],
        homeMytrion: 'billing',
      }),
    );
    // Profile/role names deliberately avoid department substrings so the legacy floor is empty
    // and the Role Default alone is what grants Billing.
    const r = await mytrionAccessService.resolveWorkerAccess(
      principal({ profileName: 'Mystery', zohoRole: 'Ops Specialist' }),
    );
    expect(r.accessibleMytrions).toEqual(['billing']);
    expect(r.homeMytrion).toBe('billing');
    expect(r.departments).toEqual(['billing']);
    expect(r.allDepartmentAccess).toBe(false);
  });

  it('role default does not wipe Sales legacy floor when Profile Default is unset (Admin configures profiles)', async () => {
    // Zoho profile "Sales" with no Admin Profile Default row yet, but some Role Default exists.
    // Previously role-only started at [] and locked them out of the app.
    rd.findByKey.mockResolvedValue(
      roleDefault({
        roleName: 'Uzbekistan Sales',
        allowedMytrions: [],
        homeMytrion: null,
      }),
    );
    const r = await mytrionAccessService.resolveWorkerAccess(
      principal({ profileName: 'Sales', zohoRole: 'Uzbekistan Sales' }),
    );
    expect(r.accessibleMytrions).toContain('sales');
    expect(r.homeMytrion).toBe('sales');
  });

  it('role UNIONs onto profile defaults (additive grants)', async () => {
    pd.findByKey.mockResolvedValue(profileDefault({ allowedMytrions: ['sales'], homeMytrion: 'sales' }));
    rd.findByKey.mockResolvedValue(
      roleDefault({ allowedMytrions: ['billing'], homeMytrion: 'billing' }),
    );
    const r = await mytrionAccessService.resolveWorkerAccess(
      principal({ profileName: 'Sales Agent', zohoRole: 'Collections Agent' }),
    );
    expect(r.accessibleMytrions.sort()).toEqual(['billing', 'sales']);
    expect(r.homeMytrion).toBe('billing'); // role home overlays profile home
  });

  it('per-user override still REPLACES the combined profile+role set', async () => {
    pd.findByKey.mockResolvedValue(profileDefault({ allowedMytrions: ['sales'] }));
    rd.findByKey.mockResolvedValue(roleDefault({ allowedMytrions: ['billing'] }));
    wa.findByZohoUserId.mockResolvedValue(override({ allowedMytrions: ['finance'], homeMytrion: 'finance' }));
    const r = await mytrionAccessService.resolveWorkerAccess(
      principal({ profileName: 'Sales Agent', zohoRole: 'Collections Agent' }),
    );
    expect(r.accessibleMytrions).toEqual(['finance']);
    expect(r.homeMytrion).toBe('finance');
  });

  it('role allDepartmentAccess grants Full Mytrions', async () => {
    rd.findByKey.mockResolvedValue(roleDefault({ allDepartmentAccess: true }));
    const r = await mytrionAccessService.resolveWorkerAccess(
      principal({ profileName: 'Standard', zohoRole: 'Team Lead' }),
    );
    expect(r.allDepartmentAccess).toBe(true);
    expect(r.accessibleMytrions.length).toBe(MYTRION_IDS.length);
  });
});

describe('resolveWorkerAccess — mytrion access modes (read|full)', () => {
  it('role can downgrade profile-granted Billing to read-only', async () => {
    pd.findByKey.mockResolvedValue(
      profileDefault({ allowedMytrions: ['sales', 'billing'], homeMytrion: 'sales' }),
    );
    rd.findByKey.mockResolvedValue(
      roleDefault({
        allowedMytrions: [],
        mytrionAccessModes: { billing: 'read' },
      }),
    );
    const r = await mytrionAccessService.resolveWorkerAccess(
      principal({ profileName: 'Standard Plus', zohoRole: 'Collections Agent' }),
    );
    expect(r.accessibleMytrions.sort()).toEqual(['billing', 'sales']);
    expect(r.mytrionAccessModes.billing).toBe('read');
    expect(r.mytrionAccessModes.sales).toBe('full');
  });

  it('defaults HR to READ (directory-only) while other Mytrions default to full', async () => {
    // The HR write tier flip: a bare grant is look-only, so creating employees/departments is the
    // explicit "HR Manager" (hr: full) capability, not something every directory reader gets.
    pd.findByKey.mockResolvedValue(
      profileDefault({ allowedMytrions: ['hr', 'sales'], homeMytrion: 'hr' }),
    );
    const r = await mytrionAccessService.resolveWorkerAccess(principal({ profileName: 'HR' }));
    expect(r.accessibleMytrions.sort()).toEqual(['hr', 'sales']);
    expect(r.mytrionAccessModes.hr).toBe('read');
    // Every other Mytrion keeps the historical full-by-default — the flip is HR and only HR.
    expect(r.mytrionAccessModes.sales).toBe('full');
  });

  it('an explicit user full override promotes an HR directory user to HR Manager', async () => {
    pd.findByKey.mockResolvedValue(profileDefault({ allowedMytrions: ['hr'], homeMytrion: 'hr' }));
    wa.findByZohoUserId.mockResolvedValue(
      override({ allowedMytrions: ['hr'], homeMytrion: 'hr', mytrionAccessModes: { hr: 'full' } }),
    );
    const r = await mytrionAccessService.resolveWorkerAccess(principal({ profileName: 'HR' }));
    expect(r.mytrionAccessModes.hr).toBe('full');
  });

  it('all-department access makes HR full', async () => {
    pd.findByKey.mockResolvedValue(
      profileDefault({ allowedMytrions: ['hr'], allDepartmentAccess: true }),
    );
    const r = await mytrionAccessService.resolveWorkerAccess(
      principal({ profileName: 'Administrator' }),
    );
    expect(r.mytrionAccessModes.hr).toBe('full');
  });

  it('user override mode wins over role mode', async () => {
    rd.findByKey.mockResolvedValue(
      roleDefault({
        allowedMytrions: ['billing'],
        homeMytrion: 'billing',
        mytrionAccessModes: { billing: 'read' },
      }),
    );
    wa.findByZohoUserId.mockResolvedValue(
      override({
        allowedMytrions: ['billing'],
        homeMytrion: 'billing',
        mytrionAccessModes: { billing: 'full' },
      }),
    );
    const r = await mytrionAccessService.resolveWorkerAccess(
      principal({ profileName: 'Mystery', zohoRole: 'Collections Agent' }),
    );
    expect(r.mytrionAccessModes.billing).toBe('full');
  });

  it('allDepartmentAccess forces every accessible Mytrion to full', async () => {
    rd.findByKey.mockResolvedValue(
      roleDefault({
        allDepartmentAccess: true,
        mytrionAccessModes: { billing: 'read' },
      }),
    );
    const r = await mytrionAccessService.resolveWorkerAccess(
      principal({ profileName: 'Standard', zohoRole: 'Team Lead' }),
    );
    expect(r.allDepartmentAccess).toBe(true);
    expect(r.mytrionAccessModes.billing).toBe('full');
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

describe('resolveWorkerAccess — Administrator profiles are MANAGEABLE; env break-glass is not', () => {
  /**
   * The floor used to cover anything matching ADMIN_PROFILE_MARKERS ("administrator", "ceo"), which
   * made every Administrator-profile user unmanageable: Admin → User Management computed and saved
   * an override, then the resolver threw it away, so the UI showed a grant that was never enforced.
   * The immovable floor is now only the env break-glass list (ADMIN_USERS / BYPASS_USERS), which
   * cannot be edited from inside the app; a last-admin guard on the save route prevents lockout.
   */
  it('an Administrator profile is all-access by DEFAULT (nothing configured)', async () => {
    wa.findByZohoUserId.mockResolvedValue(undefined);
    const r = await mytrionAccessService.resolveWorkerAccess(
      principal({ profileName: 'Administrator', userName: 'Ann' }),
    );
    expect(r.allDepartmentAccess).toBe(true);
    expect(r.accessibleMytrions.length).toBe(MYTRION_IDS.length);
  });

  it('an explicit override CAN lower an Administrator (this is the bug that was reported)', async () => {
    wa.findByZohoUserId.mockResolvedValue(
      override({ allDepartmentAccess: false, allowedMytrions: ['sales'] }),
    );
    const r = await mytrionAccessService.resolveWorkerAccess(
      principal({ profileName: 'Administrator', userName: 'Ann' }),
    );
    expect(r.allDepartmentAccess).toBe(false);
    expect(r.accessibleMytrions).toEqual(['sales']);
  });

  it('a deny now applies to an Administrator', async () => {
    wa.findByZohoUserId.mockResolvedValue(override({ deniedMytrions: ['finance'] }));
    const r = await mytrionAccessService.resolveWorkerAccess(principal({ profileName: 'Administrator' }));
    expect(r.accessibleMytrions).not.toContain('finance');
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
