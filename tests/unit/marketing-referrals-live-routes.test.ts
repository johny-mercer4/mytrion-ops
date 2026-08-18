import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { liveMock } = vi.hoisted(() => ({
  liveMock: vi.fn(),
}));

vi.hoisted(() => {
  process.env.API_KEY = 'test-secret-key';
});

vi.mock('../../src/modules/manager/referralLive.js', () => ({
  fetchReferralLiveByReferrer: liveMock,
}));

import { buildApp } from '../../src/app.js';
import { NotFoundError } from '../../src/lib/errors.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});
afterAll(async () => app.close());
beforeEach(() => {
  liveMock.mockReset();
  liveMock.mockResolvedValue({
    referrerId: 'REF-000322',
    periodFrom: '2026-07-01',
    periodTo: '2026-07-31',
    generatedAt: '2026-08-18T00:00:00.000Z',
    calculation: 'Swipes (Legacy)',
    calculationKey: 'swipes_legacy',
    bonusAmountUsd: '400.00',
    payableAmountUsd: '400.00',
    recurring: true,
    rateUsd: 50,
    thresholdGallons: null,
    activity: { kind: 'swipes', label: 'New swipes', value: 8 },
    parent: {
      id: 'P1',
      referrerId: 'REF-000322',
      name: 'AL AZIZ EXPRESS INC',
      company: 'AL AZIZ EXPRESS INC',
    },
    children: [{ id: 'C1', name: 'Logixpress', referrerId: 'REF-000322' }],
    rows: [
      {
        role: 'child',
        name: 'Logixpress',
        childId: 'C1',
        childName: 'Logixpress',
        dealId: 'D1',
        dealName: 'Logixpress',
        carrierId: 5804841,
        bonusAmountUsd: '100.00',
        payableAmountUsd: '100.00',
        periodGallons: 0,
        periodSwipes: 2,
        cumulativeGallons: 0,
        state: 'earned',
      },
      {
        role: 'parent_itself',
        name: 'AL AZIZ EXPRESS INC',
        childId: 'C1',
        childName: 'Logixpress',
        dealId: 'D1',
        dealName: 'AL AZIZ EXPRESS INC',
        carrierId: 5789458,
        bonusAmountUsd: '300.00',
        payableAmountUsd: '300.00',
        periodGallons: 0,
        periodSwipes: 6,
        cumulativeGallons: 0,
        state: 'earned',
      },
    ],
  });
});

const API_KEY_HEADERS = { 'x-api-key': 'test-secret-key' };
const LIVE = '/v1/marketing/referrals/live';

describe('Marketing referral live route', () => {
  it('rejects a request without an API key before calculating', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `${LIVE}?referrer_id=REF-000322&period_from=2026-07-01&period_to=2026-07-31`,
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: { code: 'AUTH_ERROR' } });
    expect(liveMock).not.toHaveBeenCalled();
  });

  it('returns 404 when the referrer id is unknown', async () => {
    liveMock.mockRejectedValueOnce(new NotFoundError("Unknown referrer 'REF-MISSING'"));
    const response = await app.inject({
      method: 'GET',
      url: `${LIVE}?referrer_id=REF-MISSING&period_from=2026-07-01&period_to=2026-07-31`,
      headers: API_KEY_HEADERS,
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      error: { code: 'NOT_FOUND', message: "Unknown referrer 'REF-MISSING'" },
    });
  });

  it('returns the live parent + child payload for a keyed caller', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `${LIVE}?referrer_id=REF-000322&period_from=2026-07-01&period_to=2026-07-31`,
      headers: API_KEY_HEADERS,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      referrerId: 'REF-000322',
      periodFrom: '2026-07-01',
      periodTo: '2026-07-31',
      calculation: 'Swipes (Legacy)',
      calculationKey: 'swipes_legacy',
      bonusAmountUsd: '400.00',
      activity: { kind: 'swipes', label: 'New swipes', value: 8 },
      rows: [{ role: 'child', carrierId: 5804841 }, { role: 'parent_itself', carrierId: 5789458 }],
    });
    expect(liveMock).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'admin' }),
      'REF-000322',
      '2026-07-01',
      '2026-07-31',
    );
  });

  it('rejects missing, inverted, impossible, and overlong period_from/period_to', async () => {
    const missing = await app.inject({
      method: 'GET',
      url: `${LIVE}?referrer_id=REF-000322`,
      headers: API_KEY_HEADERS,
    });
    const inverted = await app.inject({
      method: 'GET',
      url: `${LIVE}?referrer_id=REF-000322&period_from=2026-07-31&period_to=2026-07-01`,
      headers: API_KEY_HEADERS,
    });
    const impossible = await app.inject({
      method: 'GET',
      url: `${LIVE}?referrer_id=REF-000322&period_from=2026-02-31&period_to=2026-03-01`,
      headers: API_KEY_HEADERS,
    });
    const tooLong = await app.inject({
      method: 'GET',
      url: `${LIVE}?referrer_id=REF-000322&period_from=2025-01-01&period_to=2026-02-01`,
      headers: API_KEY_HEADERS,
    });
    expect(missing.statusCode).toBe(400);
    expect(inverted.statusCode).toBe(400);
    expect(impossible.statusCode).toBe(400);
    expect(tooLong.statusCode).toBe(400);
    expect(liveMock).not.toHaveBeenCalled();
  });
});
