import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  clients: vi.fn(),
  summaries: vi.fn(),
  responses: vi.fn(),
}));

vi.hoisted(() => {
  process.env.API_KEY = 'test-secret-key';
});

vi.mock('../../src/modules/verificationPipeline/service.js', () => ({
  getAgentVerificationClients: mocks.clients,
}));

vi.mock('../../src/modules/verificationPipeline/provider.js', () => ({
  getLiveVerificationSummaries: mocks.summaries,
  getPipelineProvider: () => ({ getPipeline: vi.fn(async () => null) }),
}));

vi.mock('../../src/repos/verificationSalesResponseRepo.js', () => ({
  verificationSalesResponseRepo: {
    listForRequests: mocks.responses,
    listForRequest: vi.fn(async () => []),
    findByEvent: vi.fn(),
    create: vi.fn(),
  },
}));

import { buildApp } from '../../src/app.js';
import { DEFAULT_TENANT_ID } from '../../src/config/constants.js';
import { signAccessToken } from '../../src/modules/auth/jwt.js';

let app: FastifyInstance;

const client = {
  dealId: '6227679000139590970',
  carrierId: null,
  companyName: 'Example application',
  appFillDate: '2026-08-01',
  dealStage: 'Submitted',
  classification: 'in_pipeline',
  creditScore: null,
  creditLimit: null,
  billingCycle: null,
  paymentTerms: null,
  paymentDay: null,
  minimumRequiredBalance: null,
  firstSwipeDate: null,
  lastTransactionDate: null,
  totalActiveCards: 0,
  totalSwipedCards: 0,
  activeCardsLast30Days: 0,
  isActive: false,
  isLocSuspended: false,
  isDebtor: false,
  applicationId: null,
  dot: null,
  country: 'US',
  contactSource: 'Web',
  agentName: 'Sales Worker',
  attentionCount: 0,
  verificationStatus: null,
  verificationUpdatedAt: null,
};

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => app.close());

beforeEach(() => {
  vi.clearAllMocks();
  mocks.clients.mockResolvedValue({ clients: [client], total: 1 });
  mocks.summaries.mockResolvedValue(new Map());
  mocks.responses.mockResolvedValue([]);
});

async function headers(): Promise<Record<string, string>> {
  const token = await signAccessToken({
    userId: 'zoho:42',
    tenantId: DEFAULT_TENANT_ID,
    audience: 'internal',
    role: 'admin',
    worker: { zohoUserId: '42', userName: 'Sales Worker', profile: 'Sales Agent' },
  });
  return { authorization: `Bearer ${token}` };
}

describe('Sales Verification clients dependency isolation', () => {
  it('returns DWH cards when response-history enrichment is unavailable', async () => {
    mocks.responses.mockRejectedValue(Object.assign(new Error('relation does not exist'), { code: '42P01' }));

    const response = await app.inject({
      method: 'GET',
      url: '/v1/verification/clients',
      headers: await headers(),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      clients: [{ dealId: '6227679000139590970', companyName: 'Example application' }],
      pagination: { page: 1, pageSize: 9, total: 1, pageCount: 1 },
    });
  });

  it('returns DWH cards when live Verification summaries are temporarily unavailable', async () => {
    mocks.summaries.mockRejectedValue(new Error('verification replica unavailable'));

    const response = await app.inject({
      method: 'GET',
      url: '/v1/verification/clients',
      headers: await headers(),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().clients[0]).toMatchObject({ attentionCount: 0, verificationStatus: null });
  });

  it('uses 502 only for an actual CRM roster failure', async () => {
    mocks.clients.mockRejectedValue(new Error('Zoho CRM unavailable'));

    const response = await app.inject({
      method: 'GET',
      url: '/v1/verification/clients?q=actual-crm-failure',
      headers: await headers(),
    });

    expect(response.statusCode).toBe(502);
    expect(mocks.responses).not.toHaveBeenCalled();
  });

  it('scopes the roster by Zoho user id alone and passes bounded pagination + search', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/verification/clients?page=3&page_size=9&q=acme',
      headers: await headers(),
    });

    expect(response.statusCode).toBe(200);
    // No display name: the Zoho source scopes on `Owner = '<id>'`. The old DWH source keyed on an
    // agent NAME, so a rename or a warehouse mismatch silently emptied an agent's pipeline.
    expect(mocks.clients).toHaveBeenCalledWith('42', {
      page: 3,
      pageSize: 9,
      search: 'acme',
    });
  });
});
