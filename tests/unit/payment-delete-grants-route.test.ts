/**
 * Admin management of payment_delete_grants (GET/POST/DELETE /billing/delete-grants).
 *
 * True-admin gate (allDepartmentAccess/bypassRbac), same convention as mytrionAccess.routes.ts —
 * granting this to someone else is an access-control action, not a billing-department one, so a
 * non-admin who HOLDS a grant must not be able to hand it to someone else.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

const { grantRepo, auditFromContextMock, resolveWorkerAccessMock } = vi.hoisted(() => ({
  grantRepo: { listBySource: vi.fn(), grant: vi.fn(), revoke: vi.fn() },
  auditFromContextMock: vi.fn(async (_ctx: unknown, _fields: { action: string; [k: string]: unknown }) => undefined),
  resolveWorkerAccessMock: vi.fn(),
}));
vi.mock('../../src/repos/paymentDeleteGrantRepo.js', () => ({ paymentDeleteGrantRepo: grantRepo }));
vi.mock('../../src/modules/audit/auditLogger.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/modules/audit/auditLogger.js')>();
  return { ...mod, audit: vi.fn(async () => undefined), auditFromContext: auditFromContextMock };
});
vi.mock('../../src/modules/access/mytrionAccessService.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/modules/access/mytrionAccessService.js')>();
  return { ...mod, mytrionAccessService: { ...mod.mytrionAccessService, resolveWorkerAccess: resolveWorkerAccessMock } };
});

import { buildApp } from '../../src/app.js';
import { DEFAULT_TENANT_ID } from '../../src/config/constants.js';
import { signAccessToken } from '../../src/modules/auth/jwt.js';

async function tokenFor(opts: { profile: string; zohoUserId: string }): Promise<string> {
  return signAccessToken({
    userId: `zoho:${opts.zohoUserId}`,
    tenantId: DEFAULT_TENANT_ID,
    audience: 'internal',
    role: 'worker',
    worker: { zohoUserId: opts.zohoUserId, userName: 'Test Worker', profile: opts.profile },
  });
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

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
  // Mirrors the real resolver's own marker-admin step (mytrionAccessService.ts combineAccess): an
  // "Administrator" profile resolves allDepartmentAccess true regardless of any DB override. A
  // plain worker only gets billing-department access, never all-department.
  resolveWorkerAccessMock.mockImplementation(async (input: { profileName?: string | null }) => ({
    accessibleMytrions: ['billing'],
    homeMytrion: 'billing',
    allDepartmentAccess: input.profileName === 'Administrator',
    departments: input.profileName === 'Administrator' ? [] : ['billing'],
    viewAsUserIds: [],
    mytrionAccessModes: {},
    mytrionTabGrants: {},
  }));
});

describe('a plain worker (billing department, not admin)', () => {
  it('403s on list/grant/revoke — holding a delete grant would not let them hand it to someone else', async () => {
    const token = await tokenFor({ profile: 'Standard', zohoUserId: '1' });
    const list = await app.inject({ method: 'GET', url: '/v1/billing/delete-grants', headers: auth(token) });
    const grant = await app.inject({
      method: 'POST',
      url: '/v1/billing/delete-grants',
      headers: auth(token),
      payload: { zohoUserId: '12345', source: 'chase' },
    });
    expect(list.statusCode).toBe(403);
    expect(grant.statusCode).toBe(403);
    expect(grantRepo.grant).not.toHaveBeenCalled();
  });
});

describe('admin', () => {
  const adminToken = () => tokenFor({ profile: 'Administrator', zohoUserId: '1' });

  it('lists grants for a source', async () => {
    grantRepo.listBySource.mockResolvedValue([{ id: 1, zohoUserId: '12345', source: 'chase' }]);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/billing/delete-grants?source=chase',
      headers: auth(await adminToken()),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ grants: [{ zohoUserId: '12345', source: 'chase' }] });
    expect(grantRepo.listBySource).toHaveBeenCalledWith('chase');
  });

  it('grants a user and audits it', async () => {
    grantRepo.grant.mockResolvedValue({ id: 7, zohoUserId: '12345', source: 'chase' });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/billing/delete-grants',
      headers: auth(await adminToken()),
      payload: { zohoUserId: '12345', source: 'chase' },
    });
    expect(res.statusCode).toBe(200);
    expect(grantRepo.grant).toHaveBeenCalledWith(
      expect.objectContaining({ zohoUserId: '12345', source: 'chase' }),
    );
    expect(auditFromContextMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'billing.delete-grants.grant', status: 'ok' }),
    );
  });

  it('defaults source to "chase" when omitted', async () => {
    grantRepo.grant.mockResolvedValue({ id: 7, zohoUserId: '12345', source: 'chase' });
    await app.inject({
      method: 'POST',
      url: '/v1/billing/delete-grants',
      headers: auth(await adminToken()),
      payload: { zohoUserId: '12345' },
    });
    expect(grantRepo.grant).toHaveBeenCalledWith(expect.objectContaining({ source: 'chase' }));
  });

  it('revokes a grant', async () => {
    grantRepo.revoke.mockResolvedValue(true);
    const res = await app.inject({
      method: 'DELETE',
      url: '/v1/billing/delete-grants',
      headers: auth(await adminToken()),
      payload: { zohoUserId: '12345', source: 'chase' },
    });
    expect(res.statusCode).toBe(200);
    expect(grantRepo.revoke).toHaveBeenCalledWith('12345', 'chase');
  });

  it('400s revoking a grant that does not exist', async () => {
    grantRepo.revoke.mockResolvedValue(false);
    const res = await app.inject({
      method: 'DELETE',
      url: '/v1/billing/delete-grants',
      headers: auth(await adminToken()),
      payload: { zohoUserId: '99999', source: 'chase' },
    });
    expect(res.statusCode).toBe(400);
  });
});
