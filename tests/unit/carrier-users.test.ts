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
      countChildren: vi.fn(async () => 0),
      populateCarrierId: vi.fn(async () => []),
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

// Shared row fixture for the profile-model suites ('correct-horse-9' hash prepared once).
let baseHash = '';
beforeAll(async () => {
  baseHash = await hashPassword('correct-horse-9');
});
function activeRowBase(): CarrierUser {
  return {
    id: 'cu_1',
    tenantId: DEFAULT_TENANT_ID,
    profile: 'owner',
    carrierId: '5758544',
    applicationId: null,
    parentUserId: null,
    cardId: null,
    login: 'acme.owner',
    passwordHash: baseHash,
    agentName: 'Rep Riley',
    agentZohoUserId: '777',
    status: 'active',
    lastLoginAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as CarrierUser;
}

function dto(overrides: Partial<CarrierUserDto> = {}): CarrierUserDto {
  return {
    id: 'cu_1',
    profile: 'owner',
    carrierId: '5758544',
    applicationId: null,
    parentUserId: null,
    cardId: null,
    login: 'acme.owner',
    agentName: 'Rep Riley',
    agentZohoUserId: '777',
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
      client: { carrierUserId: 'cu_1', clientProfile: 'owner', carrierId: '5758544' },
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
        profile: 'owner',
        carrier_id: 5758544,
        login: 'Acme.Owner',
        password: 'super-secret-1',
        agent_name: 'Rep Riley',
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
      profile: 'owner',
      carrierId: '5758544',
      applicationId: 'APP-9',
      parentUserId: null,
      cardId: null,
      login: 'acme.owner',
      passwordHash,
      agentName: 'Rep Riley',
      agentZohoUserId: '777',
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
      client: { carrierUserId: 'cu_1', clientProfile: 'owner', carrierId: '5758544', login: 'acme.owner' },
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
      client: { carrierUserId: 'cu_1', clientProfile: 'owner', carrierId: '5758544', login: 'acme.owner' },
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

describe('owner/driver profile model', () => {
  it('provisions an owner on the application id ALONE (carrier id comes later)', async () => {
    repo.create.mockResolvedValueOnce(dto({ carrierId: null, applicationId: 'app-1024' }));
    const res = await app.inject({
      method: 'POST',
      url: '/v1/carrier-users',
      headers: { ...API_KEY_HEADERS, 'content-type': 'application/json' },
      payload: { profile: 'owner', application_id: 'APP-1024', login: 'early.bird', password: 'super-secret-1' },
    });
    expect(res.statusCode).toBe(201);
    expect(repo.create.mock.calls.at(-1)?.[1]).toMatchObject({
      profile: 'owner',
      applicationId: 'APP-1024',
    });
  });

  it('rejects an owner with NEITHER carrier_id nor application_id', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/carrier-users',
      headers: { ...API_KEY_HEADERS, 'content-type': 'application/json' },
      payload: { profile: 'owner', login: 'untied', password: 'super-secret-1' },
    });
    expect(res.statusCode).toBe(400);
    expect(repo.create).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ login: 'untied' }));
  });

  it('rejects a driver without a parent, and a parent that is not an active OWNER', async () => {
    const noParent = await app.inject({
      method: 'POST',
      url: '/v1/carrier-users',
      headers: { ...API_KEY_HEADERS, 'content-type': 'application/json' },
      payload: { profile: 'driver', card_id: '90210', login: 'lone.driver', password: 'super-secret-1' },
    });
    expect(noParent.statusCode).toBe(400);

    // Parent exists but is itself a driver.
    repo.findById.mockResolvedValueOnce({
      ...activeRowBase(), id: 'cu_drv', profile: 'driver',
    } as CarrierUser);
    const driverParent = await app.inject({
      method: 'POST',
      url: '/v1/carrier-users',
      headers: { ...API_KEY_HEADERS, 'content-type': 'application/json' },
      payload: { profile: 'driver', parent_user_id: 'cu_drv', login: 'chained', password: 'super-secret-1' },
    });
    expect(driverParent.statusCode).toBe(400);

    // Parent owner exists but is disabled.
    repo.findById.mockResolvedValueOnce({
      ...activeRowBase(), id: 'cu_off', status: 'disabled',
    } as CarrierUser);
    const disabledParent = await app.inject({
      method: 'POST',
      url: '/v1/carrier-users',
      headers: { ...API_KEY_HEADERS, 'content-type': 'application/json' },
      payload: { profile: 'driver', parent_user_id: 'cu_off', login: 'orphan', password: 'super-secret-1' },
    });
    expect(disabledParent.statusCode).toBe(400);
  });

  it('creates a driver under an active owner (card assignable now or later)', async () => {
    repo.findById.mockResolvedValueOnce(activeRowBase() as CarrierUser);
    repo.create.mockResolvedValueOnce(
      dto({ id: 'cu_d1', profile: 'driver', parentUserId: 'cu_1', cardId: '90210', carrierId: null }),
    );
    const res = await app.inject({
      method: 'POST',
      url: '/v1/carrier-users',
      headers: { ...API_KEY_HEADERS, 'content-type': 'application/json' },
      payload: { profile: 'driver', parent_user_id: 'cu_1', card_id: 90210, login: 'road.runner', password: 'super-secret-1' },
    });
    expect(res.statusCode).toBe(201);
    expect(repo.create.mock.calls.at(-1)?.[1]).toMatchObject({
      profile: 'driver',
      parentUserId: 'cu_1',
      cardId: '90210',
    });
  });

  it('deleting an owner with drivers is blocked (409)', async () => {
    repo.countChildren.mockResolvedValueOnce(2);
    const deletesBefore = repo.deleteById.mock.calls.length;
    const res = await app.inject({
      method: 'POST',
      url: '/v1/carrier-users/cu_1/delete',
      headers: { ...API_KEY_HEADERS, 'content-type': 'application/json' },
      payload: {},
    });
    expect(res.statusCode).toBe(409);
    expect(repo.deleteById.mock.calls.length).toBe(deletesBefore); // never reached the delete
  });

  it('populate-carrier back-fills every application-provisioned account and audits', async () => {
    repo.populateCarrierId.mockResolvedValueOnce([
      dto({ id: 'cu_a', carrierId: '777001', applicationId: 'app-1024' }),
      dto({ id: 'cu_b', carrierId: '777001', applicationId: 'app-1024' }),
    ]);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/carrier-users/populate-carrier',
      headers: { ...API_KEY_HEADERS, 'content-type': 'application/json' },
      payload: { application_id: 'APP-1024', carrier_id: 777001 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ count: 2 });
    expect(repo.populateCarrierId).toHaveBeenCalledWith(expect.anything(), 'APP-1024', '777001');
    expect(auditFromContext).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'admin.carrier_user.populate_carrier' }),
    );
  });
});

describe('driver login — inheritance + parent lockout', () => {
  let driverHash = '';
  beforeAll(async () => {
    driverHash = await hashPassword('drive-safe-99');
  });

  const ownerRow = (): CarrierUser =>
    ({ ...activeRowBase(), id: 'cu_own', carrierId: '5758544', applicationId: 'app-9' }) as CarrierUser;
  const driverRow = (overrides: Partial<CarrierUser> = {}): CarrierUser =>
    ({
      ...activeRowBase(),
      id: 'cu_d1',
      profile: 'driver',
      carrierId: null,
      applicationId: null,
      parentUserId: 'cu_own',
      cardId: '90210',
      login: 'road.runner',
      passwordHash: driverHash,
      ...overrides,
    }) as CarrierUser;

  it('a driver session inherits the parent company and carries the card tie', async () => {
    repo.findByLoginForAuth.mockResolvedValueOnce(driverRow());
    repo.findByIdAny.mockResolvedValueOnce(ownerRow()); // parent lookup
    const session = await clientAuthService.login('road.runner', 'drive-safe-99');
    expect(session.client).toMatchObject({
      clientProfile: 'driver',
      carrierId: '5758544', // inherited from the parent
      applicationId: 'app-9',
      cardId: '90210',
      parentUserId: 'cu_own',
    });

    const ctx = contextFromClaims(
      { userId: 'client:cu_d1', tenantId: DEFAULT_TENANT_ID, audience: 'customer', role: 'viewer', client: session.client },
      'rq',
    );
    expect(ctx.client).toMatchObject({ profile: 'driver', cardId: '90210', carrierId: '5758544' });
    expect(ctx.departments).toEqual(['5758544', 'app-9']); // company scope, same as the fleet
    expect(ctx.profiles).toEqual(['Driver']);
  });

  it('a driver cannot log in when the parent owner is disabled or gone', async () => {
    repo.findByLoginForAuth.mockResolvedValueOnce(driverRow());
    repo.findByIdAny.mockResolvedValueOnce({ ...ownerRow(), status: 'disabled' } as CarrierUser);
    await expect(clientAuthService.login('road.runner', 'drive-safe-99')).rejects.toThrow(/invalid/i);

    repo.findByLoginForAuth.mockResolvedValueOnce(driverRow());
    repo.findByIdAny.mockResolvedValueOnce(undefined);
    await expect(clientAuthService.login('road.runner', 'drive-safe-99')).rejects.toThrow(/invalid/i);
  });

  it('refresh re-derives the identity: a back-filled carrier id reaches the rotated token', async () => {
    repo.findByLoginForAuth.mockResolvedValueOnce({
      ...activeRowBase(),
      carrierId: null,
      applicationId: 'app-1024',
    } as CarrierUser);
    const session = await clientAuthService.login('acme.owner', 'correct-horse-9');
    expect(session.client.carrierId).toBeUndefined();

    // The application converted; populate-carrier back-filled the row. Refresh must pick it up.
    repo.findByIdAny.mockResolvedValueOnce({
      ...activeRowBase(),
      carrierId: '777001',
      applicationId: 'app-1024',
    } as CarrierUser);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      headers: { 'content-type': 'application/json' },
      payload: { refreshToken: session.refreshToken },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { accessToken: string; client?: { carrierId?: string } };
    expect(body.client?.carrierId).toBe('777001');
    expect((await verifyToken(body.accessToken, 'access')).client?.carrierId).toBe('777001');
  });
});
