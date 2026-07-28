/**
 * The env break-glass floor — the ONE grant the database cannot lower.
 *
 * Separate file because `env` is parsed from `process.env` once at import, so `vi.stubEnv` inside a
 * test is too late; ADMIN_USERS has to be set before the config module loads.
 *
 * Context: the immovable floor used to cover every ADMIN_PROFILE_MARKERS profile ("Administrator",
 * "ceo"), which made those users unmanageable from Admin → User Management — their override was
 * computed and then discarded. That floor now applies only to users NAMED IN SERVER ENV, which is
 * the recovery path if an admin mis-configures themselves out of the app. Everything else is
 * manageable, and the save route's last-admin guard is what prevents a lockout.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.ADMIN_USERS = 'BreakGlass Betty';
  process.env.BYPASS_USERS = 'Bypass Bob';
});

vi.mock('../../src/repos/mytrionProfileDefaultsRepo.js', () => ({
  mytrionProfileDefaultsRepo: { findByKey: vi.fn(), list: vi.fn(async () => []) },
}));
vi.mock('../../src/repos/mytrionRoleDefaultsRepo.js', () => ({
  mytrionRoleDefaultsRepo: { findByKey: vi.fn(), list: vi.fn(async () => []) },
}));
vi.mock('../../src/repos/workerMytrionAccessRepo.js', () => ({
  workerMytrionAccessRepo: { findByZohoUserId: vi.fn(), list: vi.fn(async () => []) },
}));

import { mytrionAccessService } from '../../src/modules/access/mytrionAccessService.js';
import { MYTRION_IDS } from '../../src/lib/mytrions.js';
import { mytrionProfileDefaultsRepo } from '../../src/repos/mytrionProfileDefaultsRepo.js';
import { mytrionRoleDefaultsRepo } from '../../src/repos/mytrionRoleDefaultsRepo.js';
import { workerMytrionAccessRepo } from '../../src/repos/workerMytrionAccessRepo.js';

const pd = vi.mocked(mytrionProfileDefaultsRepo);
const rd = vi.mocked(mytrionRoleDefaultsRepo);
const wa = vi.mocked(workerMytrionAccessRepo);

/** An override that strips everything it possibly can. */
const strippingOverride = {
  id: 'wma_1',
  tenantId: 't1',
  zohoUserId: 'u1',
  userName: null,
  email: null,
  profileName: null,
  allowedMytrions: ['sales'],
  deniedMytrions: ['finance', 'sales'],
  homeMytrion: null,
  allDepartmentAccess: false,
  viewAsUserIds: [],
  mytrionAccessModes: {},
  active: true,
} as never;

function principal(userName: string) {
  return { tenantId: 't1', zohoUserId: 'u1', userName, profileName: 'Standard', zohoRole: 'Agent' };
}

beforeEach(() => {
  mytrionAccessService.invalidateAll();
  pd.findByKey.mockResolvedValue(undefined as never);
  rd.findByKey.mockResolvedValue(undefined as never);
  wa.findByZohoUserId.mockResolvedValue(strippingOverride);
});

describe('env break-glass floor', () => {
  it('ADMIN_USERS keeps all-access despite an override that strips everything', async () => {
    const r = await mytrionAccessService.resolveWorkerAccess(principal('BreakGlass Betty'));
    expect(r.allDepartmentAccess).toBe(true);
    expect(r.accessibleMytrions.length).toBe(MYTRION_IDS.length);
  });

  it('BYPASS_USERS is likewise immovable', async () => {
    const r = await mytrionAccessService.resolveWorkerAccess(principal('Bypass Bob'));
    expect(r.allDepartmentAccess).toBe(true);
    expect(r.accessibleMytrions.length).toBe(MYTRION_IDS.length);
  });

  it('an ordinary worker with the SAME override is fully lowered', async () => {
    // The contrast that matters: nothing about the override changed, only who it applies to.
    const r = await mytrionAccessService.resolveWorkerAccess(principal('Regular Rita'));
    expect(r.allDepartmentAccess).toBe(false);
    expect(r.accessibleMytrions).toEqual([]);
  });
});
