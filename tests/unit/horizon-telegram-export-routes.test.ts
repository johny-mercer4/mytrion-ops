/**
 * POST /v1/horizon/telegram/export-send — Zoho Bearer, tenant-isolated sendDocument.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const sendToWorker = vi.hoisted(() => vi.fn());

vi.mock('../../src/modules/horizon/sendHorizonDocument.js', async (importOriginal) => {
  const mod =
    await importOriginal<typeof import('../../src/modules/horizon/sendHorizonDocument.js')>();
  return { ...mod, sendHorizonDocumentToLinkedWorker: sendToWorker };
});

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
import { ConflictError } from '../../src/lib/errors.js';
import { signAccessToken } from '../../src/modules/auth/jwt.js';

function multipartFile(name: string, content: string, mime = 'text/csv'): { payload: string; contentType: string } {
  const boundary = '----horizonexport';
  const payload =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${name}"\r\n` +
    `Content-Type: ${mime}\r\n\r\n` +
    `${content}\r\n` +
    `--${boundary}--\r\n`;
  return { payload, contentType: `multipart/form-data; boundary=${boundary}` };
}

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

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});
afterAll(async () => {
  await app.close();
});
beforeEach(() => {
  sendToWorker.mockReset();
});

describe('POST /v1/horizon/telegram/export-send', () => {
  it('rejects a missing bearer', async () => {
    const { payload, contentType } = multipartFile('a.csv', 'a,b\n1,2');
    const res = await app.inject({
      method: 'POST',
      url: '/v1/horizon/telegram/export-send',
      headers: { 'content-type': contentType },
      payload,
    });
    expect(res.statusCode).toBe(401);
    expect(sendToWorker).not.toHaveBeenCalled();
  });

  it('rejects a carrier-client session', async () => {
    const token = await signAccessToken({
      userId: 'client:1',
      tenantId: DEFAULT_TENANT_ID,
      audience: 'customer',
      role: 'viewer',
      client: { carrierUserId: '1', clientProfile: 'owner' },
    });
    const { payload, contentType } = multipartFile('a.csv', 'a');
    const res = await app.inject({
      method: 'POST',
      url: '/v1/horizon/telegram/export-send',
      headers: { authorization: `Bearer ${token}`, 'content-type': contentType },
      payload,
    });
    expect(res.statusCode).toBe(403);
    expect(sendToWorker).not.toHaveBeenCalled();
  });

  it('sends with the session tenant and zoho worker, not a body-supplied id', async () => {
    sendToWorker.mockResolvedValueOnce({
      chatId: '99',
      telegramUserId: '99',
      filename: 'invoices.xlsx',
    });
    const token = await workerToken();
    const { payload, contentType } = multipartFile(
      'invoices.xlsx',
      'xlsx-bytes',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    const res = await app.inject({
      method: 'POST',
      url: '/v1/horizon/telegram/export-send',
      headers: { authorization: `Bearer ${token}`, 'content-type': contentType },
      payload,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, sent: true, filename: 'invoices.xlsx' });
    expect(sendToWorker).toHaveBeenCalledTimes(1);
    expect(sendToWorker).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: DEFAULT_TENANT_ID, userId: 'zoho:42' }),
      expect.objectContaining({ filename: 'invoices.xlsx' }),
    );
  });

  it('does not send against another tenant when the session is rival', async () => {
    sendToWorker.mockResolvedValueOnce({
      chatId: '77',
      telegramUserId: '77',
      filename: 'a.csv',
    });
    const token = await workerToken({ tenantId: 'tenant_rival', zohoUserId: '99' });
    const { payload, contentType } = multipartFile('a.csv', 'a');
    const res = await app.inject({
      method: 'POST',
      url: '/v1/horizon/telegram/export-send',
      headers: { authorization: `Bearer ${token}`, 'content-type': contentType },
      payload,
    });
    expect(res.statusCode).toBe(200);
    expect(sendToWorker).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant_rival', userId: 'zoho:99' }),
      expect.anything(),
    );
    expect(sendToWorker).not.toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: DEFAULT_TENANT_ID }),
      expect.anything(),
    );
  });

  it('surfaces TELEGRAM_CHAT_UNLINKED when the worker has no Horizon link', async () => {
    sendToWorker.mockRejectedValueOnce(
      new ConflictError(
        'Telegram is not linked. Open the Mini App after Zoho login to link your Horizon bot chat.',
        { code: 'TELEGRAM_CHAT_UNLINKED' },
      ),
    );
    const token = await workerToken();
    const { payload, contentType } = multipartFile('a.csv', 'a');
    const res = await app.inject({
      method: 'POST',
      url: '/v1/horizon/telegram/export-send',
      headers: { authorization: `Bearer ${token}`, 'content-type': contentType },
      payload,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: { code: 'TELEGRAM_CHAT_UNLINKED' } });
  });
});
