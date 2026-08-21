/**
 * Data Center Broker Snapshot search (`GET /v1/verification/flow/broker-snapshot/search`).
 *
 * Thin wrap of `searchBrokerSnapshot`: one warehouse key per call, verification-gated, no case write.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.API_KEY = 'test-secret-key';
});

const searchBrokerSnapshot = vi.fn();

vi.mock('../../src/modules/verificationFlow/brokerSnapshotSearch.js', () => ({
  searchBrokerSnapshot: (...args: unknown[]) => searchBrokerSnapshot(...args),
}));

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
beforeEach(() => {
  searchBrokerSnapshot.mockReset();
  searchBrokerSnapshot.mockResolvedValue({
    available: true,
    error: null,
    matchedOn: 'dot',
    notFound: false,
    truncated: false,
    pagination: { page: 1, pageSize: 50, hasMore: false },
    records: [
      {
        id: '16079457811075937970',
        dotNumber: '8844425',
        ownerFullName: 'Abdirehin Ahmed',
        fields: { row_hash: 'abc', email: 'owner@example.com' },
      },
    ],
  });
});

async function workerToken(profile: string): Promise<string> {
  return signAccessToken({
    userId: 'zoho:42',
    tenantId: DEFAULT_TENANT_ID,
    audience: 'internal',
    role: 'admin',
    worker: { zohoUserId: '42', userName: 'Test Worker', profile },
  });
}
const bearer = (t: string): Record<string, string> => ({ authorization: `Bearer ${t}` });

describe('GET /verification/flow/broker-snapshot/search', () => {
  it('refuses unauthenticated', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/verification/flow/broker-snapshot/search?by=dot&q=8844425',
    });
    expect(res.statusCode).toBe(401);
    expect(searchBrokerSnapshot).not.toHaveBeenCalled();
  });

  it('refuses a sales-only worker', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/verification/flow/broker-snapshot/search?by=dot&q=8844425',
      headers: bearer(await workerToken('Sales Rep')),
    });
    expect(res.statusCode).toBe(403);
    expect(searchBrokerSnapshot).not.toHaveBeenCalled();
  });

  it('asks the warehouse by USDOT', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/verification/flow/broker-snapshot/search?by=dot&q=8844425',
      headers: bearer(await workerToken('Verification')),
    });
    expect(res.statusCode).toBe(200);
    expect(searchBrokerSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ by: 'dot', q: '8844425' }),
    );
    expect(res.json().records[0].ownerFullName).toBe('Abdirehin Ahmed');
    expect(res.json().records[0].fields.row_hash).toBe('abc');
  });

  it('asks the warehouse by owner name', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/verification/flow/broker-snapshot/search?by=name&q=Abdirehin',
      headers: bearer(await workerToken('Verification')),
    });
    expect(res.statusCode).toBe(200);
    expect(searchBrokerSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ by: 'name', q: 'Abdirehin' }),
    );
  });

  it('forwards page and pageSize', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/verification/flow/broker-snapshot/search?by=name&q=Abdirehin&page=2&pageSize=50',
      headers: bearer(await workerToken('Verification')),
    });
    expect(res.statusCode).toBe(200);
    expect(searchBrokerSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ by: 'name', q: 'Abdirehin', page: 2, pageSize: 50 }),
    );
  });

  it('rejects MC — that column does not exist', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/verification/flow/broker-snapshot/search?by=mc&q=307348',
      headers: bearer(await workerToken('Verification')),
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(searchBrokerSnapshot).not.toHaveBeenCalled();
  });

  it('passes a warehouse miss through as 200, not a clear', async () => {
    searchBrokerSnapshot.mockResolvedValue({
      available: false,
      error: 'DWH_DATABASE_URL is not configured',
      matchedOn: null,
      notFound: false,
      truncated: false,
      records: [],
    });
    const res = await app.inject({
      method: 'GET',
      url: '/v1/verification/flow/broker-snapshot/search?by=dot&q=8844425',
      headers: bearer(await workerToken('Verification')),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().available).toBe(false);
  });
});
