/**
 * /v1/admin/mytrion-access over HTTP — the write-path homeMytrion invariant: a grant that
 * leaves exactly one accessible Mytrion always persists that Mytrion as home (Landing then
 * auto-enters; the picker can never appear for single-Mytrion users). Plus the admin gate.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.API_KEY = 'test-secret-key';
});

vi.mock('../../src/repos/mytrionProfileDefaultsRepo.js', () => ({
  mytrionProfileDefaultsRepo: { findByKey: vi.fn(), list: vi.fn(), upsert: vi.fn() },
}));
vi.mock('../../src/repos/mytrionRoleDefaultsRepo.js', () => ({
  mytrionRoleDefaultsRepo: { findByKey: vi.fn(), list: vi.fn(), upsert: vi.fn() },
}));
vi.mock('../../src/repos/workerMytrionAccessRepo.js', () => ({
  workerMytrionAccessRepo: { findByZohoUserId: vi.fn(), list: vi.fn(), upsert: vi.fn() },
}));
vi.mock('../../src/modules/audit/auditLogger.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/modules/audit/auditLogger.js')>();
  return { ...mod, audit: vi.fn(async () => undefined), auditFromContext: vi.fn(async () => undefined) };
});
vi.mock('../../src/modules/auth/actAsDirectory.js', () => ({
  listActiveUsersCached: vi.fn(async () => [
    { zohoUserId: 'u1', name: 'Ada', email: null, profile: 'Sales Agent', role: 'Collections Agent' },
  ]),
}));

import { buildApp } from '../../src/app.js';
import { DEFAULT_TENANT_ID } from '../../src/config/constants.js';
import { mytrionAccessService } from '../../src/modules/access/mytrionAccessService.js';
import { signAccessToken } from '../../src/modules/auth/jwt.js';
import { mytrionProfileDefaultsRepo } from '../../src/repos/mytrionProfileDefaultsRepo.js';
import { mytrionRoleDefaultsRepo } from '../../src/repos/mytrionRoleDefaultsRepo.js';
import { workerMytrionAccessRepo } from '../../src/repos/workerMytrionAccessRepo.js';

const pd = vi.mocked(mytrionProfileDefaultsRepo);
const roleRepo = vi.mocked(mytrionRoleDefaultsRepo);
const wa = vi.mocked(workerMytrionAccessRepo);

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});
afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  vi.clearAllMocks();
  mytrionAccessService.invalidateAll();
  pd.findByKey.mockResolvedValue(undefined);
  pd.list.mockResolvedValue([]);
  roleRepo.findByKey.mockResolvedValue(undefined);
  roleRepo.list.mockResolvedValue([]);
  // Echo the write back as a full DTO — the assertions read what the route persisted.
  // Param/return types come from the mocked fns so this stays in lockstep with the repos.
  pd.upsert.mockImplementation(async (...[, row]: Parameters<typeof pd.upsert>) => ({
    id: 'pd_1',
    profileName: row.profileName,
    profileKey: row.profileName.toLowerCase(),
    allowedMytrions: row.allowedMytrions,
    homeMytrion: row.homeMytrion ?? null,
    allDepartmentAccess: row.allDepartmentAccess ?? false,
    active: row.active ?? true,
    createdAt: '',
    updatedAt: '',
  }));
  roleRepo.upsert.mockImplementation(async (...[, row]: Parameters<typeof roleRepo.upsert>) => ({
    id: 'rd_1',
    roleName: row.roleName,
    roleKey: row.roleName.toLowerCase(),
    allowedMytrions: row.allowedMytrions,
    homeMytrion: row.homeMytrion ?? null,
    allDepartmentAccess: row.allDepartmentAccess ?? false,
    mytrionAccessModes: row.mytrionAccessModes ?? {},
    active: row.active ?? true,
    createdAt: '',
    updatedAt: '',
  }));
  wa.findByZohoUserId.mockResolvedValue(undefined);
  wa.list.mockResolvedValue([]);
  wa.upsert.mockImplementation(async (...[, row]: Parameters<typeof wa.upsert>) => ({
    id: 'wma_1',
    zohoUserId: row.zohoUserId,
    userName: row.userName ?? null,
    email: row.email ?? null,
    profileName: row.profileName ?? null,
    allowedMytrions: row.allowedMytrions ?? null,
    deniedMytrions: row.deniedMytrions ?? [],
    homeMytrion: row.homeMytrion ?? null,
    allDepartmentAccess: row.allDepartmentAccess ?? null,
    viewAsUserIds: row.viewAsUserIds ?? [],
    mytrionAccessModes: row.mytrionAccessModes ?? {},
    active: row.active ?? true,
    createdAt: '',
    updatedAt: '',
  }));
});

/** Admin session: the Administrator profile pins allDepartmentAccess via the env-marker floor. */
async function adminToken(): Promise<string> {
  return signAccessToken({
    userId: 'zoho:admin-1',
    tenantId: DEFAULT_TENANT_ID,
    audience: 'internal',
    role: 'admin',
    worker: { zohoUserId: 'admin-1', userName: 'Ann Admin', profile: 'Administrator' },
  });
}

/** Non-admin worker session — must be locked out of user management. */
async function workerToken(): Promise<string> {
  return signAccessToken({
    userId: 'zoho:w-1',
    tenantId: DEFAULT_TENANT_ID,
    audience: 'internal',
    role: 'admin', // stale claim — re-derived to 'worker' at verify
    worker: { zohoUserId: 'w-1', userName: 'Dan Brown', profile: 'Sales Agent' },
  });
}

describe('POST /v1/admin/mytrion-access/users/:zohoUserId — home normalization', () => {
  it('a single-Mytrion override without a home persists that Mytrion as home', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/admin/mytrion-access/users/u-77',
      headers: { authorization: `Bearer ${await adminToken()}`, 'content-type': 'application/json' },
      payload: { allowedMytrions: ['billing'] },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { access: { homeMytrion: string | null } }).access.homeMytrion).toBe('billing');
  });

  it('an explicit home wins; multi-Mytrion grants without a home stay null', async () => {
    const explicit = await app.inject({
      method: 'POST',
      url: '/v1/admin/mytrion-access/users/u-78',
      headers: { authorization: `Bearer ${await adminToken()}`, 'content-type': 'application/json' },
      payload: { allowedMytrions: ['sales', 'billing'], homeMytrion: 'sales' },
    });
    expect((explicit.json() as { access: { homeMytrion: string | null } }).access.homeMytrion).toBe('sales');

    const multi = await app.inject({
      method: 'POST',
      url: '/v1/admin/mytrion-access/users/u-79',
      headers: { authorization: `Bearer ${await adminToken()}`, 'content-type': 'application/json' },
      payload: { allowedMytrions: ['sales', 'billing'] },
    });
    expect((multi.json() as { access: { homeMytrion: string | null } }).access.homeMytrion).toBeNull();
  });

  it('an inherit override (no allowedMytrions) does not invent a home', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/admin/mytrion-access/users/u-80',
      headers: { authorization: `Bearer ${await adminToken()}`, 'content-type': 'application/json' },
      payload: { deniedMytrions: ['finance'] },
    });
    expect((res.json() as { access: { homeMytrion: string | null } }).access.homeMytrion).toBeNull();
  });
});

describe('POST /v1/admin/mytrion-access/profiles/:profileKey — home normalization', () => {
  it('a single-Mytrion profile default without a home persists that Mytrion as home', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/admin/mytrion-access/profiles/sales-agent',
      headers: { authorization: `Bearer ${await adminToken()}`, 'content-type': 'application/json' },
      payload: { profileName: 'Sales Agent', allowedMytrions: ['sales'] },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { profile: { homeMytrion: string | null } }).profile.homeMytrion).toBe('sales');
  });
});

describe('POST /v1/admin/mytrion-access/roles/:roleKey — home normalization', () => {
  it('a single-Mytrion role default without a home persists that Mytrion as home', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/admin/mytrion-access/roles/collections-agent',
      headers: { authorization: `Bearer ${await adminToken()}`, 'content-type': 'application/json' },
      payload: { roleName: 'Collections Agent', allowedMytrions: ['billing'] },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { role: { homeMytrion: string | null } }).role.homeMytrion).toBe('billing');
  });

  it('persists Billing read-only mode on a role default', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/admin/mytrion-access/roles/collections-agent',
      headers: { authorization: `Bearer ${await adminToken()}`, 'content-type': 'application/json' },
      payload: {
        roleName: 'Collections Agent',
        allowedMytrions: ['billing'],
        mytrionAccessModes: { billing: 'read' },
      },
    });
    expect(res.statusCode).toBe(200);
    const role = (res.json() as { role: { mytrionAccessModes: { billing?: string } } }).role;
    expect(role.mytrionAccessModes.billing).toBe('read');
  });
});

describe('GET /v1/admin/mytrion-access/roles', () => {
  it('merges roster roles that are not yet configured', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/admin/mytrion-access/roles',
      headers: { authorization: `Bearer ${await adminToken()}` },
    });
    expect(res.statusCode).toBe(200);
    const roles = (res.json() as { roles: Array<{ roleKey: string; configured: boolean }> }).roles;
    expect(roles.some((r) => r.roleKey === 'collections agent' && r.configured === false)).toBe(true);
  });
});

describe('admin gate', () => {
  it('a Sales Agent session gets 403 on user management', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/admin/mytrion-access/profiles',
      headers: { authorization: `Bearer ${await workerToken()}` },
    });
    expect(res.statusCode).toBe(403);
  });
});
