/**
 * POST /v1/horizon/telegram/link — Zoho Bearer + Horizon initData HMAC. Not a login.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const upsert = vi.hoisted(() => vi.fn());
const listLinks = vi.hoisted(() => vi.fn());

vi.mock('../../src/repos/horizonWorkerTelegramRepo.js', () => ({
  horizonWorkerTelegramRepo: {
    upsertWebAppBind: upsert,
    refreshFromBotStart: vi.fn(),
    findByZohoUserId: vi.fn(),
    findByTelegramUserId: vi.fn(),
    list: listLinks,
  },
}));

vi.mock('../../src/modules/audit/auditLogger.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/modules/audit/auditLogger.js')>();
  return { ...mod, audit: vi.fn(async () => undefined), auditFromContext: vi.fn(async () => undefined) };
});

vi.mock('../../src/modules/access/mytrionAccessService.js', async () => {
  const dept = await import('../../src/lib/department.js');
  const { MYTRION_IDS, MYTRION_DEPARTMENT } = await import('../../src/lib/mytrions.js');
  return {
    mytrionAccessService: {
      resolveWorkerAccess: vi.fn(
        async (input: { profileName?: string | null; zohoRole?: string | null; userName?: string | null }) => {
          const envAdmin = dept.resolveAllDepartmentAccess({
            profile: input.profileName ?? null,
            role: input.zohoRole ?? null,
            userName: input.userName ?? null,
          });
          if (envAdmin) {
            return {
              accessibleMytrions: [...MYTRION_IDS],
              homeMytrion: null,
              allDepartmentAccess: true,
              departments: [],
              viewAsUserIds: [],
              mytrionAccessModes: {},
              mytrionTabGrants: {},
            };
          }
          const departments = dept.deriveWorkerDepartments(input.profileName ?? null, input.zohoRole ?? null);
          const set = new Set(departments);
          const accessible = MYTRION_IDS.filter((id) => set.has(MYTRION_DEPARTMENT[id]));
          return {
            accessibleMytrions: accessible,
            homeMytrion: accessible.length === 1 ? (accessible[0] ?? null) : null,
            allDepartmentAccess: false,
            departments,
            viewAsUserIds: [],
            mytrionAccessModes: {},
            mytrionTabGrants: {},
          };
        },
      ),
      invalidateUser: vi.fn(),
      invalidateAll: vi.fn(),
    },
  };
});

import { buildApp } from '../../src/app.js';
import { DEFAULT_TENANT_ID } from '../../src/config/constants.js';
import { signHorizonInitData } from '../../src/integrations/telegramHorizonBot.js';
import { ConflictError } from '../../src/lib/errors.js';
import { signAccessToken } from '../../src/modules/auth/jwt.js';
import { horizonWorkerTelegramRepo } from '../../src/repos/horizonWorkerTelegramRepo.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});
afterAll(async () => {
  await app.close();
});
beforeEach(() => {
  upsert.mockReset();
  listLinks.mockReset();
});

async function workerToken(overrides?: { tenantId?: string; zohoUserId?: string }): Promise<string> {
  const zohoUserId = overrides?.zohoUserId ?? '42';
  return signAccessToken({
    userId: `zoho:${zohoUserId}`,
    tenantId: overrides?.tenantId ?? DEFAULT_TENANT_ID,
    audience: 'internal',
    role: 'worker',
    worker: { zohoUserId, userName: 'Ada', email: 'ada@octane.test' },
  });
}

function signedInitData(user: { id: number; username?: string }): string {
  return signHorizonInitData({
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: 'AAE',
    user: JSON.stringify(user),
  });
}

describe('POST /v1/horizon/telegram/link', () => {
  it('rejects a missing bearer', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/horizon/telegram/link',
      payload: { initData: signedInitData({ id: 99 }) },
    });
    expect(res.statusCode).toBe(401);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('rejects a carrier-client session — Telegram is not Zoho login', async () => {
    const token = await signAccessToken({
      userId: 'client:1',
      tenantId: DEFAULT_TENANT_ID,
      audience: 'customer',
      role: 'viewer',
      client: { carrierUserId: '1', clientProfile: 'owner' },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/horizon/telegram/link',
      headers: { authorization: `Bearer ${token}` },
      payload: { initData: signedInitData({ id: 99 }) },
    });
    expect(res.statusCode).toBe(403);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('rejects initData signed with a different bot token', async () => {
    const token = await workerToken();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/horizon/telegram/link',
      headers: { authorization: `Bearer ${token}` },
      payload: { initData: 'auth_date=1&hash=deadbeef&user=%7B%22id%22%3A99%7D' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: { code: 'HORIZON_INITDATA_INVALID' } });
    expect(upsert).not.toHaveBeenCalled();
  });

  it('binds the Zoho user from the Bearer session to the Telegram user from initData', async () => {
    const token = await workerToken();
    upsert.mockResolvedValueOnce({
      id: '11111111-1111-1111-1111-111111111111',
      tenantId: DEFAULT_TENANT_ID,
      zohoUserId: '42',
      telegramUserId: '99',
      telegramChatId: '99',
      telegramUsername: 'ada',
      linkedVia: 'webapp_bind',
      status: 'active',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/horizon/telegram/link',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        initData: signedInitData({ id: 99, username: 'ada' }),
        zohoUserId: 'victim-other-worker',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      ok: true,
      linked: { zohoUserId: '42', telegramUserId: '99', telegramChatId: '99', linkedVia: 'webapp_bind' },
    });
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: DEFAULT_TENANT_ID, userId: 'zoho:42' }),
      expect.objectContaining({
        zohoUserId: '42',
        telegramUserId: '99',
        telegramChatId: '99',
        zohoUsername: 'Ada',
      }),
    );
  });

  it('does not let a rival tenant bind against the octane worker', async () => {
    const token = await workerToken({ tenantId: 'tenant_rival', zohoUserId: '99' });
    upsert.mockResolvedValueOnce({
      id: '22222222-2222-2222-2222-222222222222',
      tenantId: 'tenant_rival',
      zohoUserId: '99',
      telegramUserId: '77',
      telegramChatId: '77',
      telegramUsername: null,
      linkedVia: 'webapp_bind',
      status: 'active',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/horizon/telegram/link',
      headers: { authorization: `Bearer ${token}` },
      payload: { initData: signedInitData({ id: 77 }) },
    });

    expect(res.statusCode).toBe(200);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant_rival', userId: 'zoho:99' }),
      expect.objectContaining({ zohoUserId: '99' }),
    );
  });

  it('surfaces a conflict when the telegram id is already linked to another worker', async () => {
    const token = await workerToken();
    upsert.mockRejectedValueOnce(
      new ConflictError('This Telegram account is already linked to another worker', {
        code: 'TELEGRAM_LINKED_TO_OTHER_WORKER',
      }),
    );
    const res = await app.inject({
      method: 'POST',
      url: '/v1/horizon/telegram/link',
      headers: { authorization: `Bearer ${token}` },
      payload: { initData: signedInitData({ id: 99 }) },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: { code: 'TELEGRAM_LINKED_TO_OTHER_WORKER' } });
  });
});

describe('Horizon link repo mock isolation', () => {
  it('does not call refreshFromBotStart from the webapp bind route', async () => {
    const token = await workerToken();
    upsert.mockResolvedValueOnce({
      id: '11111111-1111-1111-1111-111111111111',
      zohoUserId: '42',
      telegramUserId: '99',
      telegramChatId: '99',
      telegramUsername: null,
      linkedVia: 'webapp_bind',
      status: 'active',
    });
    await app.inject({
      method: 'POST',
      url: '/v1/horizon/telegram/link',
      headers: { authorization: `Bearer ${token}` },
      payload: { initData: signedInitData({ id: 99 }) },
    });
    expect(horizonWorkerTelegramRepo.refreshFromBotStart).not.toHaveBeenCalled();
  });
});

describe('GET /v1/horizon/telegram/links', () => {
  it('rejects a missing bearer', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/horizon/telegram/links' });
    expect(res.statusCode).toBe(401);
    expect(listLinks).not.toHaveBeenCalled();
  });

  it('rejects a worker without all-department access', async () => {
    const token = await workerToken();
    const res = await app.inject({
      method: 'GET',
      url: '/v1/horizon/telegram/links',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
    expect(listLinks).not.toHaveBeenCalled();
  });

  it('lists mapped fields for an admin, scoped to the session tenant', async () => {
    const token = await signAccessToken({
      userId: 'zoho:42',
      tenantId: DEFAULT_TENANT_ID,
      audience: 'internal',
      role: 'admin',
      worker: {
        zohoUserId: '42',
        userName: 'Ada',
        email: 'ada@octane.test',
        profile: 'Administrator',
      },
    });
    listLinks.mockResolvedValueOnce([
      {
        zohoUsername: 'Ada Lovelace',
        zohoUserId: '42',
        telegramUserId: '99',
        telegramUsername: 'ada',
        updatedAt: new Date('2026-08-13T16:00:00.000Z'),
      },
    ]);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/horizon/telegram/links',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      items: [
        {
          userName: 'Ada Lovelace',
          zohoUserId: '42',
          telegramUserId: '99',
          telegramUsername: 'ada',
          lastLoginAt: '2026-08-13T16:00:00.000Z',
        },
      ],
    });
    expect(listLinks).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: DEFAULT_TENANT_ID, allDepartmentAccess: true }),
    );
  });
});
