/**
 * Rejection reports — the Deluge webhook and the agent-scoped list that replaced the Zoho Desk scan.
 *
 * Pins the things that would silently break the feature: the shared secret actually gates the write,
 * an empty body cannot create a blank row (app.ts's JSON parser turns `` into `{}`), the owning agent
 * is resolved from the carrier id, a warehouse failure still records the decline, and a non-admin
 * only ever sees their own reports.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.API_KEY = 'test-secret-key';
  process.env.REJECTION_WEBHOOK_SECRET = 'test-rejection-secret';
});

type Row = Record<string, unknown>;
const { createMock, listForAgentMock, listAllMock, findOwnerMock } = vi.hoisted(() => ({
  createMock: vi.fn(async (_ctx: unknown, _input: Record<string, unknown>) => ({}) as Row),
  listForAgentMock: vi.fn(async (_ctx: unknown, _opts: Record<string, unknown>) => [] as Row[]),
  listAllMock: vi.fn(async (_ctx: unknown, _opts: Record<string, unknown>) => [] as Row[]),
  findOwnerMock: vi.fn(async (_carrierId: string | number) => null as Row | null),
}));

vi.mock('../../src/repos/rejectionReportRepo.js', () => ({
  rejectionReportRepo: {
    create: createMock,
    listForAgent: listForAgentMock,
    listAll: listAllMock,
    findByTicketId: vi.fn(),
    listUnassigned: vi.fn(),
  },
}));
vi.mock('../../src/integrations/dwhClientRoster.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/integrations/dwhClientRoster.js')>();
  return { ...mod, findCarrierOwner: findOwnerMock };
});
vi.mock('../../src/modules/audit/auditLogger.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/modules/audit/auditLogger.js')>();
  return { ...mod, audit: vi.fn(async () => undefined), auditFromContext: vi.fn(async () => undefined) };
});

import { buildApp } from '../../src/app.js';
import { DEFAULT_TENANT_ID } from '../../src/config/constants.js';
import { signAccessToken } from '../../src/modules/auth/jwt.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});
afterAll(async () => {
  await app.close();
});

const ROW = {
  id: 'mrr_1',
  zohoTicketId: 'tkt-1',
  errorCode: '25',
  errorDescription: 'Limit Exceeded',
  carrierId: '5806565',
  companyName: 'ZHU LOGISTICS LLC',
  cardLast4: '1234',
  agentZohoUserId: '6227679000031473048',
  agentName: 'Daniel Brown',
  ownerSource: 'dim_company',
  status: 'new',
  occurredAt: new Date('2026-07-27T12:00:00Z'),
  createdAt: new Date('2026-07-27T12:00:01Z'),
} as never;

beforeEach(() => {
  createMock.mockReset().mockResolvedValue(ROW);
  listForAgentMock.mockReset().mockResolvedValue([]);
  listAllMock.mockReset().mockResolvedValue([]);
  findOwnerMock.mockReset().mockResolvedValue({
    carrierId: '5806565',
    companyName: 'ZHU LOGISTICS LLC',
    agentZohoUserId: '6227679000031473048',
    agentName: 'Daniel Brown',
    source: 'dim_company',
  });
});

const BODY = {
  ticketId: 'tkt-1',
  errorCode: '25',
  errorDescription: 'Limit Exceeded',
  carrierId: '5806565',
  companyName: 'ZHU LOGISTICS LLC',
  cardNumber: '7083051234',
  driverName: 'John Driver',
  createdTime: '2026-07-27 12:00:00',
};

function post(body: unknown, secret?: string) {
  return app.inject({
    method: 'POST',
    url: '/v1/rejection-reports/webhook',
    headers: {
      'content-type': 'application/json',
      ...(secret === undefined ? {} : { 'x-rejection-secret': secret }),
    },
    payload: body as Record<string, unknown>,
  });
}

describe('POST /v1/rejection-reports/webhook', () => {
  it('rejects a missing or wrong secret without writing', async () => {
    expect((await post(BODY)).statusCode).toBe(401);
    expect((await post(BODY, 'nope')).statusCode).toBe(401);
    expect(createMock).not.toHaveBeenCalled();
  });

  it('stores a decline and binds it to the carrier’s owning agent', async () => {
    const res = await post(BODY, 'test-rejection-secret');
    expect(res.statusCode).toBe(201);
    expect(findOwnerMock).toHaveBeenCalledWith('5806565');
    const input = createMock.mock.calls[0]![1];
    expect(input).toMatchObject({
      zohoTicketId: 'tkt-1',
      errorCode: '25',
      carrierId: '5806565',
      agentZohoUserId: '6227679000031473048',
      agentName: 'Daniel Brown',
      ownerSource: 'dim_company',
    });
    // Deluge sends a naive "yyyy-MM-dd HH:mm:ss"; it must land as a real timestamp.
    expect((input.occurredAt as Date).toISOString()).toBe('2026-07-27T12:00:00.000Z');
  });

  it('still records the decline when the warehouse lookup fails', async () => {
    findOwnerMock.mockRejectedValueOnce(new Error('DWH down'));
    const res = await post(BODY, 'test-rejection-secret');
    expect(res.statusCode).toBe(201);
    expect((createMock.mock.calls[0]![1]).ownerSource).toBe('unresolved');
  });

  it('marks an unknown carrier unresolved rather than dropping it', async () => {
    findOwnerMock.mockResolvedValueOnce(null);
    await post(BODY, 'test-rejection-secret');
    const input = createMock.mock.calls[0]![1];
    expect(input.ownerSource).toBe('unresolved');
    expect(input.agentZohoUserId).toBeNull();
  });

  it('treats a string "false" as false, not truthy', async () => {
    // z.coerce.boolean() would make "false" true and silently flag every decline as fraud.
    await post({ ...BODY, isFraud: 'false', isNetwork: 'true' }, 'test-rejection-secret');
    const input = createMock.mock.calls[0]![1];
    expect(input.isFraud).toBe(false);
    expect(input.isNetwork).toBe(true);
  });

  it('accepts real JSON booleans too (what Deluge normally emits)', async () => {
    await post({ ...BODY, isFraud: true, isNetwork: false }, 'test-rejection-secret');
    const input = createMock.mock.calls[0]![1];
    expect(input.isFraud).toBe(true);
    expect(input.isNetwork).toBe(false);
  });

  it('refuses an empty body instead of writing a blank row', async () => {
    // app.ts parses an empty JSON body as {} — an all-optional schema would accept it silently.
    const res = await post({}, 'test-rejection-secret');
    expect(res.statusCode).toBe(400);
    expect(createMock).not.toHaveBeenCalled();
  });
});

describe('GET /v1/data-center/rejections', () => {
  async function token(profile: string) {
    return signAccessToken({
      userId: 'zoho:6227679000031473048',
      tenantId: DEFAULT_TENANT_ID,
      audience: 'internal',
      role: 'admin',
      worker: { zohoUserId: '6227679000031473048', userName: 'Daniel Brown', profile },
    });
  }

  it('scopes a sales agent to their own reports (id AND name are offered)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/data-center/rejections',
      headers: { authorization: `Bearer ${await token('Sales Agent')}` },
    });
    expect(res.statusCode).toBe(200);
    expect(listAllMock).not.toHaveBeenCalled();
    const opts = listForAgentMock.mock.calls[0]![1];
    expect(opts.agentZohoUserId).toBe('6227679000031473048');
    expect(opts.agentName).toBe('Daniel Brown');
  });

  it('an ADMIN with no target is owner-scoped too, not given the org feed', async () => {
    // Data Center is "your pipeline": Leads/Deals resolve through resolveZohoUserId for admins as
    // well, and rejections silently doing otherwise meant an admin saw a mixed org-wide list here.
    const res = await app.inject({
      method: 'GET',
      url: '/v1/data-center/rejections',
      headers: { authorization: `Bearer ${await token('Administrator')}` },
    });
    expect(res.statusCode).toBe(200);
    expect(listAllMock).not.toHaveBeenCalled();
    expect(listForAgentMock.mock.calls[0]![1]).toMatchObject({
      agentZohoUserId: '6227679000031473048',
      agentName: 'Daniel Brown',
    });
  });

  it('?all=1 is the explicit admin opt-in for the whole tenant feed', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/data-center/rejections?all=1',
      headers: { authorization: `Bearer ${await token('Administrator')}` },
    });
    expect(res.statusCode).toBe(200);
    expect(listAllMock).toHaveBeenCalled();
  });

  it('?all=1 does NOT give a plain agent the org feed', async () => {
    await app.inject({
      method: 'GET',
      url: '/v1/data-center/rejections?all=1',
      headers: { authorization: `Bearer ${await token('Sales Agent')}` },
    });
    expect(listAllMock).not.toHaveBeenCalled();
    expect(listForAgentMock).toHaveBeenCalled();
  });

  it('does not leak the whole feed to a non-admin', async () => {
    listForAgentMock.mockResolvedValueOnce([ROW]);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/data-center/rejections',
      headers: { authorization: `Bearer ${await token('Sales Agent')}` },
    });
    const body = res.json() as { rejections: Array<Record<string, unknown>> };
    expect(body.rejections).toHaveLength(1);
    // The full PAN must never reach the wire — only the last 4.
    expect(body.rejections[0]).not.toHaveProperty('cardNumber');
    expect(body.rejections[0]!.cardLast4).toBe('1234');
  });
});
