/**
 * Data Center (/v1/data-center) + RingCentral (/v1/ringcentral) — authorization regressions.
 * The header-elevation attack (x-all-departments + ?zoho_user_id=<victim>) must stay closed,
 * and the RingCentral embed config must not ship the shared client secret / org JWT to the
 * browser unless RINGCENTRAL_BROWSER_CREDS_ACK is deliberately set.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.API_KEY = 'test-secret-key';
});

vi.mock('../../src/integrations/salesDataCenter.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/integrations/salesDataCenter.js')>();
  return {
    ...mod,
    fetchAgentLeads: vi.fn(async () => []),
    fetchAgentDeals: vi.fn(async () => []),
    fetchAgentApplicationStats: vi.fn(async () => ({
      days: {},
      total: 0,
      windowDays: 90,
      truncated: false,
    })),
    fetchLeadOwnerId: vi.fn(async () => '42'),
    fetchDealOwnerId: vi.fn(async () => '42'),
  };
});
vi.mock('../../src/integrations/zohoCrmRecords.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/integrations/zohoCrmRecords.js')>();
  return { ...mod, zohoCrmRecords: { ...mod.zohoCrmRecords, updateRecord: vi.fn(async () => ({})) } };
});
vi.mock('../../src/modules/customerService/fieldResolver.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/modules/customerService/fieldResolver.js')>();
  // Identity resolver: the allowlist keys are already exact API-cased in these routes.
  return { ...mod, resolveWritePayload: vi.fn(async (_module: string, payload: Record<string, unknown>) => payload) };
});
vi.mock('../../src/integrations/zohoDesk.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/integrations/zohoDesk.js')>();
  return { ...mod, listRejectionReportTickets: vi.fn(async () => []) };
});
vi.mock('../../src/integrations/dwhClientRoster.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/integrations/dwhClientRoster.js')>();
  return { ...mod, fetchAgentClients: vi.fn(async () => []) };
});
vi.mock('../../src/modules/audit/auditLogger.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/modules/audit/auditLogger.js')>();
  return { ...mod, audit: vi.fn(async () => undefined), auditFromContext: vi.fn(async () => undefined) };
});

import { buildApp } from '../../src/app.js';
import { DEFAULT_TENANT_ID } from '../../src/config/constants.js';
import { env } from '../../src/config/env.js';
import {
  fetchAgentApplicationStats,
  fetchAgentLeads,
  fetchDealOwnerId,
  fetchLeadOwnerId,
} from '../../src/integrations/salesDataCenter.js';
import { fetchAgentClients } from '../../src/integrations/dwhClientRoster.js';
import { zohoCrmRecords } from '../../src/integrations/zohoCrmRecords.js';
import { auditFromContext } from '../../src/modules/audit/auditLogger.js';
import { signAccessToken } from '../../src/modules/auth/jwt.js';

const leadsMock = vi.mocked(fetchAgentLeads);
const appStatsMock = vi.mocked(fetchAgentApplicationStats);
const clientsMock = vi.mocked(fetchAgentClients);
const leadOwnerMock = vi.mocked(fetchLeadOwnerId);
const dealOwnerMock = vi.mocked(fetchDealOwnerId);
const updateRecordMock = vi.mocked(zohoCrmRecords.updateRecord);

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
  leadsMock.mockResolvedValue([]);
});

async function workerToken(profile: string, zohoUserId = '42'): Promise<string> {
  return signAccessToken({
    userId: `zoho:${zohoUserId}`,
    tenantId: DEFAULT_TENANT_ID,
    audience: 'internal',
    role: 'admin', // stale claim — re-derived from the profile at verify
    worker: { zohoUserId, userName: 'Robiya', profile },
  });
}

function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

describe('data-center leads — header elevation regression', () => {
  it('a non-sales worker asserting x-department-access: sales is refused', async () => {
    const token = await workerToken('Billing Clerk');
    const res = await app.inject({
      method: 'GET',
      url: '/v1/data-center/leads',
      headers: { ...bearer(token), 'x-department-access': 'sales' },
    });
    expect(res.statusCode).toBe(403);
    expect(leadsMock).not.toHaveBeenCalled();
  });

  it('x-all-departments + ?zoho_user_id never reads the victim pipeline', async () => {
    const token = await workerToken('Sales Rep');
    const res = await app.inject({
      method: 'GET',
      url: '/v1/data-center/leads?zoho_user_id=999',
      headers: { ...bearer(token), 'x-all-departments': 'true' },
    });
    expect(res.statusCode).toBe(200);
    expect(leadsMock).toHaveBeenCalledWith('42');
    expect(leadsMock).not.toHaveBeenCalledWith('999');
  });

  it('a sales-profile worker reads their own leads with NO headers', async () => {
    const token = await workerToken('Sales Rep');
    const res = await app.inject({
      method: 'GET',
      url: '/v1/data-center/leads',
      headers: bearer(token),
    });
    expect(res.statusCode).toBe(200);
    expect(leadsMock).toHaveBeenCalledWith('42');
  });

  it('an admin may target another agent via ?zoho_user_id', async () => {
    const token = await workerToken('Administrator');
    const res = await app.inject({
      method: 'GET',
      url: '/v1/data-center/leads?zoho_user_id=999',
      headers: bearer(token),
    });
    expect(res.statusCode).toBe(200);
    expect(leadsMock).toHaveBeenCalledWith('999');
  });
});

describe('data-center app-stats — owner scope + RBAC (Home goal bar / streak)', () => {
  it('a non-sales worker is refused', async () => {
    const token = await workerToken('Billing Clerk');
    const res = await app.inject({
      method: 'GET',
      url: '/v1/data-center/app-stats',
      headers: { ...bearer(token), 'x-department-access': 'sales' },
    });
    expect(res.statusCode).toBe(403);
    expect(appStatsMock).not.toHaveBeenCalled();
  });

  it('a sales worker gets their OWN stats — never a victim via ?zoho_user_id + x-all-departments', async () => {
    appStatsMock.mockResolvedValue({ days: { '2026-07-20': 3 }, total: 3, windowDays: 90, truncated: false });
    const token = await workerToken('Sales Rep');
    const res = await app.inject({
      method: 'GET',
      url: '/v1/data-center/app-stats?zoho_user_id=999',
      headers: { ...bearer(token), 'x-all-departments': 'true' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ days: { '2026-07-20': 3 }, total: 3 });
    expect(appStatsMock).toHaveBeenCalledWith('42');
    expect(appStatsMock).not.toHaveBeenCalledWith('999');
  });

  it('an admin may target another agent via ?zoho_user_id', async () => {
    appStatsMock.mockResolvedValue({ days: {}, total: 0, windowDays: 90, truncated: false });
    const token = await workerToken('Administrator');
    const res = await app.inject({
      method: 'GET',
      url: '/v1/data-center/app-stats?zoho_user_id=999',
      headers: bearer(token),
    });
    expect(res.statusCode).toBe(200);
    expect(appStatsMock).toHaveBeenCalledWith('999');
  });
});

describe('data-center clients — owner scope + RBAC (Clients roster + gallons)', () => {
  const sampleClient = {
    carrierId: '123',
    companyName: 'Acme Trucking',
    contact: 'Jane Doe',
    phone: '555-0100',
    producedCards: 6,
    activeCards: 4,
    moneyCode: 'MC-1',
    dot: '12345',
    isLocSuspended: false,
    computedIsActive: true,
    computedDebt: 0,
    computedDebtDays: 0,
    cycleGallons: 1200,
    gallonsThisMonth: 500,
    activeCardsThisMonth: 4,
    transactionsThisMonth: 40,
    gallonsPrevMonth: 450,
    activeCardsPrevMonth: 3,
  };

  it('a non-sales worker is refused', async () => {
    const token = await workerToken('Billing Clerk');
    const res = await app.inject({
      method: 'GET',
      url: '/v1/data-center/clients',
      headers: { ...bearer(token), 'x-department-access': 'sales' },
    });
    expect(res.statusCode).toBe(403);
    expect(clientsMock).not.toHaveBeenCalled();
  });

  it('a sales worker gets their OWN roster — never a victim via ?zoho_user_id + x-all-departments', async () => {
    clientsMock.mockResolvedValue([sampleClient]);
    const token = await workerToken('Sales Rep');
    const res = await app.inject({
      method: 'GET',
      url: '/v1/data-center/clients?zoho_user_id=999',
      headers: { ...bearer(token), 'x-all-departments': 'true' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ clients: [{ carrierId: '123', gallonsThisMonth: 500 }] });
    // Own id + own display name (the name arm resolves the SAME carriers the roster shows).
    expect(clientsMock).toHaveBeenCalledWith('42', 'Robiya');
    expect(clientsMock).not.toHaveBeenCalledWith('999');
    expect(clientsMock).not.toHaveBeenCalledWith('999', expect.anything());
  });

  it('an admin may target another agent via ?zoho_user_id', async () => {
    clientsMock.mockResolvedValue([]);
    const token = await workerToken('Administrator');
    const res = await app.inject({
      method: 'GET',
      url: '/v1/data-center/clients?zoho_user_id=999',
      headers: bearer(token),
    });
    expect(res.statusCode).toBe(200);
    // Admin act-as by id → id path only (no name fallback; we don't have the target's name).
    expect(clientsMock).toHaveBeenCalledWith('999', undefined);
  });

  it('the plain frontend call forwards the caller name so the DWH name arm can fire', async () => {
    // Regression: the Clients tab calls with NO ?zoho_user_id. The route must pass the caller's
    // display name so fetchAgentClients can resolve by dim_company.agent when the session id doesn't
    // match the warehouse agent_zoho_user_id — otherwise the roster is empty / every client shows 0.
    clientsMock.mockResolvedValue([]);
    const token = await workerToken('Sales Rep');
    const res = await app.inject({
      method: 'GET',
      url: '/v1/data-center/clients',
      headers: bearer(token),
    });
    expect(res.statusCode).toBe(200);
    expect(clientsMock).toHaveBeenCalledWith('42', 'Robiya');
  });
});

describe('data-center lead/deal edit — owner scope + allowlist (RBAC rule #9)', () => {
  beforeEach(() => {
    leadOwnerMock.mockResolvedValue('42');
    dealOwnerMock.mockResolvedValue('42');
    updateRecordMock.mockResolvedValue({} as never);
  });

  it('a non-sales worker cannot edit a lead', async () => {
    const token = await workerToken('Billing Clerk');
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/data-center/leads/555',
      headers: { ...bearer(token), 'x-department-access': 'sales' },
      payload: { MC: 'MC-1' },
    });
    expect(res.statusCode).toBe(403);
    expect(updateRecordMock).not.toHaveBeenCalled();
  });

  it('a sales rep edits their OWN lead (allowlisted fields written + audited)', async () => {
    const token = await workerToken('Sales Rep');
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/data-center/leads/555',
      headers: bearer(token),
      payload: { MC: 'MC-1', Phone: '5551234567', DOT: '1234567' },
    });
    expect(res.statusCode).toBe(200);
    expect(leadOwnerMock).toHaveBeenCalledWith('555');
    expect(updateRecordMock).toHaveBeenCalledWith(
      'Leads',
      '555',
      expect.objectContaining({ MC: 'MC-1', Phone: '5551234567', DOT: '1234567' }),
    );
    expect(res.json()).toMatchObject({ id: '555', updatedFields: expect.arrayContaining(['MC', 'Phone', 'DOT']) });
    expect(auditFromContext).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'sales.datacenter.lead_update', resourceId: '555' }),
    );
  });

  it('a sales rep CANNOT edit a lead owned by someone else (403, no write) — even with ?zoho_user_id + x-all-departments', async () => {
    leadOwnerMock.mockResolvedValue('999');
    const token = await workerToken('Sales Rep');
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/data-center/leads/555?zoho_user_id=999',
      headers: { ...bearer(token), 'x-all-departments': 'true' },
      payload: { MC: 'X' },
    });
    expect(res.statusCode).toBe(403);
    expect(updateRecordMock).not.toHaveBeenCalled();
  });

  it('editing a non-existent lead → 404 (no write)', async () => {
    leadOwnerMock.mockResolvedValue(null);
    const token = await workerToken('Sales Rep');
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/data-center/leads/555',
      headers: bearer(token),
      payload: { MC: 'X' },
    });
    expect(res.statusCode).toBe(404);
    expect(updateRecordMock).not.toHaveBeenCalled();
  });

  it('an unknown/non-allowlisted field is rejected (400, no write)', async () => {
    const token = await workerToken('Sales Rep');
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/data-center/leads/555',
      headers: bearer(token),
      payload: { Amount: 5000 },
    });
    expect(res.statusCode).toBe(400);
    expect(updateRecordMock).not.toHaveBeenCalled();
  });

  it('a non-numeric record id is rejected (400)', async () => {
    const token = await workerToken('Sales Rep');
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/data-center/leads/not-an-id',
      headers: bearer(token),
      payload: { MC: 'X' },
    });
    expect(res.statusCode).toBe(400);
    expect(updateRecordMock).not.toHaveBeenCalled();
  });

  it('an admin acting-as an agent (?zoho_user_id) edits that agent’s deal', async () => {
    dealOwnerMock.mockResolvedValue('999');
    const token = await workerToken('Administrator');
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/data-center/deals/777?zoho_user_id=999',
      headers: bearer(token),
      payload: { Phone: '5559998888' },
    });
    expect(res.statusCode).toBe(200);
    expect(updateRecordMock).toHaveBeenCalledWith('Deals', '777', expect.objectContaining({ Phone: '5559998888' }));
  });

  it('an admin WITHOUT act-as cannot edit another agent’s deal (owner mismatch → 403)', async () => {
    dealOwnerMock.mockResolvedValue('999');
    const token = await workerToken('Administrator');
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/data-center/deals/777',
      headers: bearer(token),
      payload: { Phone: 'x' },
    });
    expect(res.statusCode).toBe(403);
    expect(updateRecordMock).not.toHaveBeenCalled();
  });
});

describe('ringcentral embed-config — browser credentials', () => {
  const savedEnabled = env.FF_RINGCENTRAL_ENABLED;
  const savedAck = env.RINGCENTRAL_BROWSER_CREDS_ACK;
  const savedId = env.RINGCENTRAL_CLIENT_ID;
  const savedSecret = env.RINGCENTRAL_CLIENT_SECRET;
  const savedJwt = env.RINGCENTRAL_JWT;

  beforeAll(() => {
    env.FF_RINGCENTRAL_ENABLED = true;
    env.RINGCENTRAL_CLIENT_ID = 'rc-client-id';
    env.RINGCENTRAL_CLIENT_SECRET = 'rc-super-secret';
    env.RINGCENTRAL_JWT = 'rc-org-jwt';
  });
  afterAll(() => {
    env.FF_RINGCENTRAL_ENABLED = savedEnabled;
    env.RINGCENTRAL_BROWSER_CREDS_ACK = savedAck;
    env.RINGCENTRAL_CLIENT_ID = savedId;
    env.RINGCENTRAL_CLIENT_SECRET = savedSecret;
    env.RINGCENTRAL_JWT = savedJwt;
  });

  it('a non-sales worker cannot fetch the config at all', async () => {
    const token = await workerToken('Billing Clerk');
    const res = await app.inject({
      method: 'GET',
      url: '/v1/ringcentral/embed-config',
      headers: { ...bearer(token), 'x-department-access': 'sales' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('default (ack off): the response carries NO client secret and NO JWT', async () => {
    env.RINGCENTRAL_BROWSER_CREDS_ACK = false;
    const token = await workerToken('Sales Rep');
    const res = await app.inject({
      method: 'GET',
      url: '/v1/ringcentral/embed-config',
      headers: bearer(token),
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('rc-super-secret');
    expect(res.body).not.toContain('rc-org-jwt');
    expect(res.json().adapterUrl).toContain('clientId=rc-client-id');
  });

  it('ack on: credentials ship (Phase-1 behavior) and the fetch is audited', async () => {
    env.RINGCENTRAL_BROWSER_CREDS_ACK = true;
    const token = await workerToken('Sales Rep');
    const res = await app.inject({
      method: 'GET',
      url: '/v1/ringcentral/embed-config',
      headers: bearer(token),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().adapterUrl).toContain('rc-super-secret');
    expect(auditFromContext).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'ringcentral.embed_config' }),
    );
  });
});

describe('ringcentral embed-config — OAuth sign-in without a shared JWT', () => {
  const saved = {
    enabled: env.FF_RINGCENTRAL_ENABLED,
    ack: env.RINGCENTRAL_BROWSER_CREDS_ACK,
    id: env.RINGCENTRAL_CLIENT_ID,
    secret: env.RINGCENTRAL_CLIENT_SECRET,
    jwt: env.RINGCENTRAL_JWT,
  };
  beforeAll(() => {
    env.FF_RINGCENTRAL_ENABLED = true;
    env.RINGCENTRAL_BROWSER_CREDS_ACK = false;
    env.RINGCENTRAL_CLIENT_ID = 'rc-client-id';
    env.RINGCENTRAL_CLIENT_SECRET = '';
    env.RINGCENTRAL_JWT = '';
  });
  afterAll(() => {
    env.FF_RINGCENTRAL_ENABLED = saved.enabled;
    env.RINGCENTRAL_BROWSER_CREDS_ACK = saved.ack;
    env.RINGCENTRAL_CLIENT_ID = saved.id;
    env.RINGCENTRAL_CLIENT_SECRET = saved.secret;
    env.RINGCENTRAL_JWT = saved.jwt;
  });

  it('serves the adapter config from CLIENT_ID alone (agents sign in in the widget)', async () => {
    const token = await workerToken('Sales Rep');
    const res = await app.inject({
      method: 'GET',
      url: '/v1/ringcentral/embed-config',
      headers: bearer(token),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().enabled).toBe(true);
    expect(res.json().adapterUrl).toContain('clientId=rc-client-id');
    expect(res.body).not.toContain('clientSecret=');
    expect(res.body).not.toContain('jwt=');
  });
});

describe('ringcentral call-events — capture', () => {
  it('a non-sales worker cannot post call events', async () => {
    const token = await workerToken('Billing Clerk');
    const res = await app.inject({
      method: 'POST',
      url: '/v1/ringcentral/call-events',
      headers: { ...bearer(token), 'x-department-access': 'sales' },
      payload: { kind: 'ended', to: '+15551230000' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('a sales worker’s ended-call event is accepted (202) and audited', async () => {
    const token = await workerToken('Sales Rep');
    const res = await app.inject({
      method: 'POST',
      url: '/v1/ringcentral/call-events',
      headers: bearer(token),
      payload: {
        kind: 'ended',
        direction: 'Outbound',
        to: '+15551230000',
        sessionId: 'sess-1',
        durationMs: 42_000,
        dealId: 'deal-9',
      },
    });
    expect(res.statusCode).toBe(202);
    expect(auditFromContext).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'ringcentral.call_event',
        resourceId: 'sess-1',
        detail: expect.objectContaining({ kind: 'ended', to: '+15551230000', dealId: 'deal-9' }),
      }),
    );
  });

  it('rejects an unknown event kind (schema validation)', async () => {
    const token = await workerToken('Sales Rep');
    const res = await app.inject({
      method: 'POST',
      url: '/v1/ringcentral/call-events',
      headers: bearer(token),
      payload: { kind: 'bogus' },
    });
    expect(res.statusCode).toBe(400);
  });
});
