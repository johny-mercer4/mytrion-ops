/**
 * Carrier User Management + carrier-client login. RBAC coverage (CLAUDE.md rule 9 spirit):
 * the admin CRUD surface must reject worker-role and customer sessions, and a minted client
 * session must be locked down (audience customer, no scopes, own company tags only) with
 * body identity fully ignored.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.API_KEY = 'test-secret-key';
});

vi.mock('../../src/repos/carrierUserRepo.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/repos/carrierUserRepo.js')>();
  return {
    toCarrierUserDto: mod.toCarrierUserDto,
    carrierUserRepo: {
      list: vi.fn(async () => ({ users: [], total: 0 })),
      findById: vi.fn(async () => undefined),
      findByIdAny: vi.fn(async () => undefined),
      findByLoginForAuth: vi.fn(async () => undefined),
      create: vi.fn(),
      update: vi.fn(async () => null),
      deleteById: vi.fn(async () => false),
      updateLastLogin: vi.fn(async () => undefined),
    },
  };
});
vi.mock('../../src/modules/audit/auditLogger.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/modules/audit/auditLogger.js')>();
  return {
    ...mod,
    audit: vi.fn(async () => undefined),
    auditFromContext: vi.fn(async () => undefined),
  };
});
vi.mock('../../src/repos/conversationRepo.js', () => ({
  conversationRepo: {
    findOwned: vi.fn(async () => undefined),
    findById: vi.fn(async () => undefined),
    listForUser: vi.fn(async () => []),
    countForUser: vi.fn(async () => 0),
    update: vi.fn(async () => null),
    updateOwned: vi.fn(async () => null),
    deleteById: vi.fn(async () => false),
    deleteByIdOwned: vi.fn(async () => false),
    create: vi.fn(),
    setTitle: vi.fn(async () => undefined),
    bumpForTurn: vi.fn(async () => undefined),
  },
}));
vi.mock('../../src/repos/messageRepo.js', () => ({
  messageRepo: { listTranscript: vi.fn(async () => []) },
}));

import { buildApp } from '../../src/app.js';
import { DEFAULT_TENANT_ID } from '../../src/config/constants.js';
import { contextFromClaims } from '../../src/modules/auth/authService.js';
import { clientAuthService } from '../../src/modules/auth/clientAuthService.js';
import { signAccessToken, verifyToken, type TokenClaims } from '../../src/modules/auth/jwt.js';
import { hashPassword } from '../../src/modules/auth/password.js';
import { auditFromContext } from '../../src/modules/audit/auditLogger.js';
import { buildCallerContext } from '../../src/routes/v1/callerIdentity.js';
import { carrierUserRepo, type CarrierUserDto } from '../../src/repos/carrierUserRepo.js';
import { conversationRepo } from '../../src/repos/conversationRepo.js';
import type { CarrierUser } from '../../src/db/schema/index.js';

const repo = vi.mocked(carrierUserRepo);

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});
afterAll(async () => {
  await app.close();
});

const API_KEY_HEADERS = { 'x-api-key': 'test-secret-key' };

function dto(overrides: Partial<CarrierUserDto> = {}): CarrierUserDto {
  return {
    id: 'cu_1',
    carrierId: '5758544',
    applicationId: null,
    login: 'acme.owner',
    agentName: 'Rep Riley',
    agentZohoUserId: '777',
    profile: 'Carrier Owner',
    status: 'active',
    lastLoginAt: null,
    createdAt: '2026-07-06T00:00:00.000Z',
    updatedAt: '2026-07-06T00:00:00.000Z',
    ...overrides,
  };
}

async function workerToken(profile: string): Promise<string> {
  return signAccessToken({
    userId: 'zoho:42',
    tenantId: DEFAULT_TENANT_ID,
    audience: 'internal',
    role: 'admin', // stale claim — role is re-derived from the profile at verify
    worker: { zohoUserId: '42', userName: 'Bob', profile },
  });
}

describe('carrier-users routes — admin gate', () => {
  it('static API key (admin system identity) can list', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/carrier-users', headers: API_KEY_HEADERS });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ users: [], total: 0 });
  });

  it('rejects unauthenticated access', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/carrier-users' });
    expect(res.statusCode).toBe(401);
  });

  it('denies a non-admin worker session (role worker)', async () => {
    const token = await workerToken('Sales Rep');
    const res = await app.inject({
      method: 'GET',
      url: '/v1/carrier-users',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('allows an admin-profile worker session', async () => {
    const token = await workerToken('Administrator');
    const res = await app.inject({
      method: 'GET',
      url: '/v1/carrier-users',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it('denies a carrier-client session (customers cannot manage carrier users)', async () => {
    const token = await signAccessToken({
      userId: 'client:cu_1',
      tenantId: DEFAULT_TENANT_ID,
      audience: 'customer',
      role: 'viewer',
      client: { carrierUserId: 'cu_1', carrierId: '5758544' },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/v1/carrier-users',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('carrier-users routes — CRUD', () => {
  it('creates with a HASHED password and never echoes a hash', async () => {
    repo.create.mockResolvedValueOnce(dto());
    const res = await app.inject({
      method: 'POST',
      url: '/v1/carrier-users',
      headers: { ...API_KEY_HEADERS, 'content-type': 'application/json' },
      payload: {
        carrier_id: 5758544,
        login: 'Acme.Owner',
        password: 'super-secret-1',
        agent_name: 'Rep Riley',
        profile: 'Carrier Owner',
      },
    });
    expect(res.statusCode).toBe(201);
    const input = repo.create.mock.calls.at(-1)?.[1];
    expect(input?.passwordHash).toMatch(/^\$2/); // bcrypt, not the plaintext
    expect(input?.passwordHash).not.toContain('super-secret-1');
    expect(JSON.stringify(res.json())).not.toContain('$2'); // DTO carries no hash
    expect(auditFromContext).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'admin.carrier_user.create' }),
    );
  });

  it('rejects a weak password (min 8)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/carrier-users',
      headers: { ...API_KEY_HEADERS, 'content-type': 'application/json' },
      payload: { carrier_id: '1', login: 'abc', password: 'short' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('update requires at least one field', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/carrier-users/cu_1',
      headers: { ...API_KEY_HEADERS, 'content-type': 'application/json' },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('password reset re-hashes and audits without logging the value', async () => {
    repo.update.mockResolvedValueOnce(dto());
    const res = await app.inject({
      method: 'POST',
      url: '/v1/carrier-users/cu_1',
      headers: { ...API_KEY_HEADERS, 'content-type': 'application/json' },
      payload: { password: 'new-secret-123' },
    });
    expect(res.statusCode).toBe(200);
    expect(repo.update.mock.calls.at(-1)?.[2]?.passwordHash).toMatch(/^\$2/);
    const auditDetail = vi
      .mocked(auditFromContext)
      .mock.calls.at(-1)?.[1] as { detail?: Record<string, unknown> };
    expect(JSON.stringify(auditDetail)).not.toContain('new-secret-123');
  });

  it('delete 404s on unknown id and works via the POST alias', async () => {
    repo.deleteById.mockResolvedValueOnce(false);
    const miss = await app.inject({
      method: 'POST',
      url: '/v1/carrier-users/ghost/delete',
      headers: { ...API_KEY_HEADERS, 'content-type': 'application/json' },
      payload: {},
    });
    expect(miss.statusCode).toBe(404);

    repo.deleteById.mockResolvedValueOnce(true);
    const hit = await app.inject({
      method: 'POST',
      url: '/v1/carrier-users/cu_1/delete',
      headers: { ...API_KEY_HEADERS, 'content-type': 'application/json' },
      payload: {},
    });
    expect(hit.statusCode).toBe(200);
    expect(hit.json()).toEqual({ deleted: true, id: 'cu_1' });
  });
});

describe('carrier-client login (/v1/auth/client/login + clientAuthService)', () => {
  let passwordHash = '';
  beforeAll(async () => {
    passwordHash = await hashPassword('correct-horse-9');
  });

  const activeRow = (overrides: Partial<CarrierUser> = {}): CarrierUser =>
    ({
      id: 'cu_1',
      tenantId: DEFAULT_TENANT_ID,
      carrierId: '5758544',
      applicationId: 'APP-9',
      login: 'acme.owner',
      passwordHash,
      agentName: 'Rep Riley',
      agentZohoUserId: '777',
      profile: 'Carrier Owner',
      status: 'active',
      lastLoginAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    }) as CarrierUser;

  it('mints a customer session whose context is locked to the carrier tags', async () => {
    repo.findByLoginForAuth.mockResolvedValueOnce(activeRow());
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/client/login',
      headers: { 'content-type': 'application/json' },
      payload: { login: 'Acme.Owner', password: 'correct-horse-9' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { accessToken: string; client: { carrierId: string } };
    expect(body.client.carrierId).toBe('5758544');

    const claims = await verifyToken(body.accessToken, 'access');
    const ctx = contextFromClaims(claims, 'rq');
    expect(ctx.audience).toBe('customer');
    expect(ctx.role).toBe('viewer');
    expect(ctx.scopes).toEqual([]);
    expect(ctx.departments).toEqual(['5758544', 'app-9']);
    expect(ctx.allDepartmentAccess).toBe(false);
    expect(ctx.sessionVerified).toBe(true);
    expect(ctx.userId).toBe('client:cu_1');
  });

  it('rejects a wrong password and a disabled account identically', async () => {
    repo.findByLoginForAuth.mockResolvedValueOnce(activeRow());
    await expect(clientAuthService.login('acme.owner', 'wrong')).rejects.toThrow(/invalid/i);

    repo.findByLoginForAuth.mockResolvedValueOnce(activeRow({ status: 'disabled' }));
    await expect(clientAuthService.login('acme.owner', 'correct-horse-9')).rejects.toThrow(
      /invalid/i,
    );
  });

  it('rejects an unknown login without leaking which part failed', async () => {
    repo.findByLoginForAuth.mockResolvedValueOnce(undefined);
    await expect(clientAuthService.login('ghost', 'whatever-123')).rejects.toThrow(/invalid/i);
  });

  it('body identity/scope fields are IGNORED for a client session (buildCallerContext)', async () => {
    const claims: TokenClaims = {
      userId: 'client:cu_1',
      tenantId: DEFAULT_TENANT_ID,
      audience: 'customer',
      role: 'viewer',
      client: { carrierUserId: 'cu_1', carrierId: '5758544', login: 'acme.owner' },
    };
    const ctx = contextFromClaims(claims, 'rq');
    const request = {
      ctx,
      headers: { 'x-act-as-zoho-user-id': '999' }, // even act-as headers must be inert
      log: { warn: vi.fn(), info: vi.fn() },
    } as unknown as FastifyRequest;
    const merged = await buildCallerContext(request, {
      profile: 'Administrator', // spoof attempts, every vector
      allDepartments: true,
      department_scope: ['finance', 'billing'],
      zoho_user_id: '1',
      user_name: 'Mallory',
    });
    expect(merged.departments).toEqual(['5758544']);
    expect(merged.allDepartmentAccess).toBe(false);
    expect(merged.audience).toBe('customer');
    expect(merged.userId).toBe('client:cu_1');
    expect(merged.impersonatorUserId).toBeUndefined();
  });

  it('refresh rejects once the account is disabled', async () => {
    repo.findByLoginForAuth.mockResolvedValueOnce(activeRow());
    const session = await clientAuthService.login('acme.owner', 'correct-horse-9');

    repo.findByIdAny.mockResolvedValueOnce(activeRow({ status: 'disabled' }));
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      headers: { 'content-type': 'application/json' },
      payload: { refreshToken: session.refreshToken },
    });
    expect(res.statusCode).toBe(401);
  });

  it('refresh rotates tokens for an active account', async () => {
    repo.findByLoginForAuth.mockResolvedValueOnce(activeRow());
    const session = await clientAuthService.login('acme.owner', 'correct-horse-9');

    repo.findByIdAny.mockResolvedValueOnce(activeRow());
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      headers: { 'content-type': 'application/json' },
      payload: { refreshToken: session.refreshToken },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { accessToken: string; client?: { carrierId: string } };
    expect(body.client?.carrierId).toBe('5758544');
    expect((await verifyToken(body.accessToken, 'access')).client?.carrierUserId).toBe('cu_1');
  });
});

describe('client session containment — the new login surface cannot reach internal data', () => {
  async function clientToken(): Promise<string> {
    return signAccessToken({
      userId: 'client:cu_1',
      tenantId: DEFAULT_TENANT_ID,
      audience: 'customer',
      role: 'viewer',
      client: { carrierUserId: 'cu_1', carrierId: '5758544', login: 'acme.owner' },
    });
  }

  it('is denied on the knowledge management routes (audience gate)', async () => {
    const token = await clientToken();
    for (const url of ['/v1/knowledge/docs', '/v1/knowledge/stats']) {
      const res = await app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });
      expect(res.statusCode).toBe(403);
    }
    const query = await app.inject({
      method: 'POST',
      url: '/v1/knowledge/query',
      headers: { authorization: `Bearer ${await clientToken()}`, 'content-type': 'application/json' },
      payload: { query: 'late fees', allDepartments: true },
    });
    expect(query.statusCode).toBe(403);
  });

  it('is denied on the scope-risk routes (audience gate)', async () => {
    const token = await clientToken();
    const res = await app.inject({ method: 'GET', url: '/v1/scope/risks', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(403);
  });

  it('conversation reads are owner-locked to the token identity — body zoho_user_id is ignored', async () => {
    const token = await clientToken();
    const res = await app.inject({
      method: 'GET',
      url: '/v1/chat/conversations/conv_x?zoho_user_id=555', // spoof: another user's owner key
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404); // owner-scoped miss, never the tenant-wide fallback
    const owned = vi.mocked(conversationRepo.findOwned);
    expect(owned).toHaveBeenCalled();
    expect((owned.mock.calls.at(-1)?.[0] as { userId: string }).userId).toBe('client:cu_1');
    expect(conversationRepo.findById).not.toHaveBeenCalled();
  });

  it('conversation deletes are owner-locked the same way', async () => {
    const token = await clientToken();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat/conversations/conv_x/delete',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { zoho_user_id: '555' },
    });
    expect(res.statusCode).toBe(404);
    const owned = vi.mocked(conversationRepo.deleteByIdOwned);
    expect((owned.mock.calls.at(-1)?.[0] as { userId: string }).userId).toBe('client:cu_1');
    expect(conversationRepo.deleteById).not.toHaveBeenCalled();
  });

  it('a verified non-admin WORKER is also owner-locked (no cross-user transcript reads)', async () => {
    const token = await workerToken('Sales Rep');
    await app.inject({
      method: 'GET',
      url: '/v1/chat/conversations/conv_x?zoho_user_id=999', // spoof another rep's id
      headers: { authorization: `Bearer ${token}` },
    });
    const owned = vi.mocked(conversationRepo.findOwned);
    expect((owned.mock.calls.at(-1)?.[0] as { userId: string }).userId).toBe('zoho:42');
  });
});
