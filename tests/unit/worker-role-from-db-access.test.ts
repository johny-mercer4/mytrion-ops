/**
 * The signed-in worker's internal ROLE must follow Admin → User Management, not a hardcoded list.
 *
 * Regression cover for "the bypass logic works only for admin". `role` was derived solely from
 * hardcoded admin markers (profile/role substrings + ADMIN_USERS env names) while
 * `allDepartmentAccess` had moved to the DB resolver. So an admin granting all-department access in
 * User Management got a session with `allDepartmentAccess: true` AND `role: 'worker'` + read-only
 * scopes — and every gate written `ctx.role !== 'admin'` refused them. The grant looked applied in the
 * UI and did nothing on the API.
 *
 * The hardcoded marker must remain a FLOOR (env break-glass keeps working when the DB grants nothing)
 * but must never be able to DENY a DB-granted bypass.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.API_KEY = 'test-secret-key';
  // No hardcoded admins: every 'admin' below must therefore come from the DB resolver.
  process.env.ADMIN_USERS = '';
  process.env.BYPASS_USERS = '';
});

const resolveWorkerAccessMock = vi.hoisted(() => vi.fn());
vi.mock('../../src/modules/access/mytrionAccessService.js', () => ({
  mytrionAccessService: { resolveWorkerAccess: resolveWorkerAccessMock },
}));

import { authService } from '../../src/modules/auth/authService.js';
import { signAccessToken } from '../../src/modules/auth/jwt.js';
import { DEFAULT_TENANT_ID } from '../../src/config/constants.js';

/** What the DB resolver returns for a worker. */
function access(overrides: { allDepartmentAccess: boolean; accessibleMytrions?: string[] }) {
  return {
    accessibleMytrions: overrides.accessibleMytrions ?? [],
    homeMytrion: null,
    allDepartmentAccess: overrides.allDepartmentAccess,
    departments: [],
    viewAsUserIds: [],
    mytrionAccessModes: {},
  };
}

/** Build a verified worker session context the way every request does. */
async function contextFor(worker: { zohoUserId: string; userName?: string; profile?: string; zohoRole?: string }) {
  const token = await signAccessToken({
    userId: `zoho:${worker.zohoUserId}`,
    tenantId: DEFAULT_TENANT_ID,
    audience: 'internal',
    // Deliberately a STALE 'worker' hint — the context must re-derive, never trust the claim.
    role: 'worker',
    worker,
  });
  return authService.contextFromAccessToken(token, 'req_test');
}

beforeEach(() => {
  resolveWorkerAccessMock.mockReset();
});

describe('worker role follows DB-resolved access', () => {
  it('a User Management grant of all-department access confers the admin role', async () => {
    resolveWorkerAccessMock.mockResolvedValue(access({ allDepartmentAccess: true }));
    const ctx = await contextFor({ zohoUserId: '12', userName: 'Daniel Brown', profile: 'Sales Agent', zohoRole: 'Sales' });
    // Nothing about this identity matches an admin marker — the grant is the only source.
    expect(ctx.allDepartmentAccess).toBe(true);
    expect(ctx.role).toBe('admin');
    expect(ctx.scopes.length).toBeGreaterThan(0);
  });

  it('an ordinary worker with no grant stays a worker', async () => {
    resolveWorkerAccessMock.mockResolvedValue(access({ allDepartmentAccess: false, accessibleMytrions: ['sales'] }));
    const ctx = await contextFor({ zohoUserId: '13', userName: 'Ordinary Person', profile: 'Sales Agent', zohoRole: 'Sales' });
    expect(ctx.role).toBe('worker');
    expect(ctx.allDepartmentAccess).toBe(false);
  });

  it('a hardcoded admin-marker profile still resolves when the DB grants nothing (break-glass floor)', async () => {
    resolveWorkerAccessMock.mockResolvedValue(access({ allDepartmentAccess: false }));
    const ctx = await contextFor({ zohoUserId: '1', userName: 'Ada', profile: 'Administrator', zohoRole: 'CEO' });
    // The floor must not be removable by the DB returning false, or a config slip locks out every admin.
    expect(ctx.role).toBe('admin');
  });

  it('role and allDepartmentAccess never disagree in the direction that breaks admin routes', async () => {
    // The precise broken state: DB says all-access, role said worker.
    resolveWorkerAccessMock.mockResolvedValue(access({ allDepartmentAccess: true }));
    const ctx = await contextFor({ zohoUserId: '77', userName: 'Granted Person', profile: 'Standard', zohoRole: 'Rep' });
    expect(ctx.allDepartmentAccess && ctx.role !== 'admin').toBe(false);
  });
});
