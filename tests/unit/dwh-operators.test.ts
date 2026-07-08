/**
 * DWH operator/card directory — search semantics over octane.stg_cmp_user (mocked dwhQuery)
 * and octane.stg_cmp_card, plus the admin route gates.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.API_KEY = 'test-secret-key';
  process.env.DWH_DATABASE_URL = 'postgres://dwh.example/analytics';
});

vi.mock('../../src/integrations/dwh.js', () => ({
  dwhQuery: vi.fn(async () => []),
  getDwhPool: vi.fn(),
  closeDwhPool: vi.fn(async () => undefined),
}));

import { buildApp } from '../../src/app.js';
import { dwhQuery } from '../../src/integrations/dwh.js';
import { searchDwhOperators } from '../../src/integrations/dwhOperators.js';
import { listDwhCards } from '../../src/integrations/dwhCards.js';

const query = vi.mocked(dwhQuery);

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});
afterAll(async () => {
  await app.close();
});

beforeEach(() => query.mockClear());

describe('searchDwhOperators — query construction', () => {
  it('browse mode: current rows only, most recently updated first', async () => {
    await searchDwhOperators({});
    const [sql, params] = query.mock.calls.at(-1) as [string, unknown[]];
    expect(sql).toContain('octane.stg_cmp_user');
    expect(sql).toContain('u.is_active = true');
    expect(sql).toContain('order by u.updated_date desc nulls last');
    expect(params).toEqual([]);
  });

  it('numeric search matches carrier id by prefix', async () => {
    await searchDwhOperators({ q: '5837' });
    const [sql, params] = query.mock.calls.at(-1) as [string, unknown[]];
    expect(sql).toContain('u.carrier_id::text like $1');
    expect(params).toEqual(['5837%']);
  });

  it('text search matches company name (ILIKE, contains)', async () => {
    await searchDwhOperators({ q: 'grant express' });
    const [sql, params] = query.mock.calls.at(-1) as [string, unknown[]];
    expect(sql).toContain('u.company_name ilike $1');
    expect(params).toEqual(['%grant express%']);
  });

  it('maps rows to the wire DTO (string ids)', async () => {
    query.mockResolvedValueOnce([
      {
        user_id: '5193',
        username: 'ops@example.com',
        carrier_id: 5821452,
        company_name: 'BOBKA1992INC',
        phone_number: '3194198881',
        first_name: 'Alimardon',
        last_name: 'Madumarov',
        activated: true,
        enabled: true,
      },
    ]);
    const operators = await searchDwhOperators({ q: 'bobka' });
    expect(operators[0]).toEqual({
      servercrmUserId: '5193',
      username: 'ops@example.com',
      carrierId: '5821452',
      companyName: 'BOBKA1992INC',
      phoneNumber: '3194198881',
      ownerFirstName: 'Alimardon',
      ownerLastName: 'Madumarov',
      activated: true,
      enabled: true,
    });
  });

  it('caps the limit at 100', async () => {
    await searchDwhOperators({ limit: 5000 });
    expect((query.mock.calls.at(-1) as [string])[0]).toContain('limit 100');
  });
});

describe('listDwhCards — query construction', () => {
  it('filters to the carrier, current rows only, newest first', async () => {
    await listDwhCards('5821452');
    const [sql, params] = query.mock.calls.at(-1) as [string, unknown[]];
    expect(sql).toContain('octane.stg_cmp_card');
    expect(sql).toContain('is_active = true and carrier_id = $1');
    expect(sql).toContain('order by card_id desc');
    expect(params).toEqual(['5821452']);
  });

  it('maps rows to the wire DTO (string ids/balance)', async () => {
    query.mockResolvedValueOnce([
      { card_id: 42, card_number: '7083050030880417899', card_type: 'TCH', status: 'A', balance: '12.50' },
    ]);
    const cards = await listDwhCards('5821452');
    expect(cards[0]).toEqual({
      cardId: '42',
      cardNumber: '7083050030880417899',
      cardType: 'TCH',
      status: 'A',
      balance: '12.50',
    });
  });

  it('caps the limit at 200', async () => {
    await listDwhCards('5821452', 5000);
    expect((query.mock.calls.at(-1) as [string])[0]).toContain('limit 200');
  });
});

describe('GET /v1/carrier-users/dwh-operators — admin gate + wiring', () => {
  it('returns operator results for the API key admin', async () => {
    query.mockResolvedValueOnce([
      {
        user_id: '1',
        username: 'owner@acme.com',
        carrier_id: 1,
        company_name: 'Acme',
        phone_number: null,
        first_name: null,
        last_name: null,
        activated: true,
        enabled: true,
      },
    ]);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/carrier-users/dwh-operators?q=acme',
      headers: { 'x-api-key': 'test-secret-key' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { operators: Array<{ companyName: string }> };
    expect(body.operators[0]?.companyName).toBe('Acme');
  });

  it('denies unauthenticated requests', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/carrier-users/dwh-operators' });
    expect(res.statusCode).toBe(401);
  });

  it('maps DWH failures to a 502 (not a raw 500)', async () => {
    query.mockRejectedValueOnce(new Error('connection refused'));
    const res = await app.inject({
      method: 'GET',
      url: '/v1/carrier-users/dwh-operators',
      headers: { 'x-api-key': 'test-secret-key' },
    });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ error: { code: 'DWH_ERROR' } });
  });
});

describe('GET /v1/carrier-users/dwh-cards — admin gate + wiring', () => {
  it('returns cards for the API key admin', async () => {
    query.mockResolvedValueOnce([
      { card_id: 1, card_number: '123', card_type: 'TCH', status: 'A', balance: '0.00' },
    ]);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/carrier-users/dwh-cards?carrier_id=5821452',
      headers: { 'x-api-key': 'test-secret-key' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { cards: Array<{ cardNumber: string }> };
    expect(body.cards[0]?.cardNumber).toBe('123');
  });

  it('requires carrier_id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/carrier-users/dwh-cards',
      headers: { 'x-api-key': 'test-secret-key' },
    });
    expect(res.statusCode).toBe(400);
  });
});
