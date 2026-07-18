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
  };
});
vi.mock('../../src/integrations/zohoDesk.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/integrations/zohoDesk.js')>();
  return { ...mod, listRejectionReportTickets: vi.fn(async () => []) };
});
vi.mock('../../src/modules/audit/auditLogger.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/modules/audit/auditLogger.js')>();
  return { ...mod, audit: vi.fn(async () => undefined), auditFromContext: vi.fn(async () => undefined) };
});

import { buildApp } from '../../src/app.js';
import { DEFAULT_TENANT_ID } from '../../src/config/constants.js';
import { env } from '../../src/config/env.js';
import { fetchAgentLeads } from '../../src/integrations/salesDataCenter.js';
import { auditFromContext } from '../../src/modules/audit/auditLogger.js';
import { signAccessToken } from '../../src/modules/auth/jwt.js';

const leadsMock = vi.mocked(fetchAgentLeads);

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
