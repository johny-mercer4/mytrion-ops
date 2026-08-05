/**
 * /v1/billing/ingest/payment (existing) + /v1/billing/transactions/auto-map (new) — the two
 * shared-secret webhooks in paymentsIngest.routes.ts. The new one lets servercrm's ingest-time
 * auto-map job (jobs/mxAutoMapByName.js) stamp a carrier it resolved from CMP directly (company-name
 * search), auditing it as a synthetic system actor since there's no session context.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

const { applyAutoMapMock, upsertManyMock, markIngestMappedMock, auditMock } = vi.hoisted(() => ({
  applyAutoMapMock: vi.fn(),
  upsertManyMock: vi.fn(async () => 1),
  markIngestMappedMock: vi.fn(async () => undefined),
  auditMock: vi.fn(async (_input: { action: string; [k: string]: unknown }) => undefined),
}));
vi.mock('../../src/repos/paymentTransactionRepo.js', () => ({
  paymentTransactionRepo: {
    applyAutoMap: applyAutoMapMock,
    upsertMany: upsertManyMock,
    markIngestMapped: markIngestMappedMock,
    money: (n: number) => n.toFixed(2),
  },
}));
vi.mock('../../src/modules/audit/auditLogger.js', () => ({ audit: auditMock }));

import { buildApp } from '../../src/app.js';
import { env } from '../../src/config/env.js';

const SECRET = env.BILLING_INGEST_SECRET;

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
});

// `null` means "send no x-ingest-secret header at all" — distinct from omitting the arg (which
// defaults to the real SECRET). A plain `undefined` default param would NOT distinguish these,
// since an explicitly-passed `undefined` also triggers the default.
function post(url: string, body: Record<string, unknown>, secret: string | null = SECRET) {
  return app.inject({
    method: 'POST',
    url,
    headers: secret !== null ? { 'x-ingest-secret': secret } : {},
    payload: body,
  });
}

describe('POST /v1/billing/transactions/auto-map', () => {
  it('401s with a missing or wrong secret — never touches the repo', async () => {
    const res = await post('/v1/billing/transactions/auto-map', { transactionId: 1, carrierId: '5801437' }, 'wrong-secret');
    expect(res.statusCode).toBe(401);
    expect(applyAutoMapMock).not.toHaveBeenCalled();

    const res2 = await post('/v1/billing/transactions/auto-map', { transactionId: 1, carrierId: '5801437' }, null);
    expect(res2.statusCode).toBe(401);
  });

  it('400s on a missing carrierId', async () => {
    const res = await post('/v1/billing/transactions/auto-map', { transactionId: 1 });
    expect(res.statusCode).toBe(400);
    expect(applyAutoMapMock).not.toHaveBeenCalled();
  });

  it('applies the mapping and audits as the synthetic system actor', async () => {
    applyAutoMapMock.mockResolvedValue({ id: 900, carrierId: '5823382' });

    const res = await post('/v1/billing/transactions/auto-map', {
      transactionId: 900,
      carrierId: '5823382',
      via: 'name',
      companyName: 'ROAD WARRIORS TRANS INC',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'success', transactionId: 900, applied: true });
    expect(applyAutoMapMock).toHaveBeenCalledWith(900, {
      carrierId: '5823382',
      mappingType: 'Auto-Mapped (CMP)',
      mappedBy: 'CMP auto-map (ingest)',
    });
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'billing.transactions.auto-map',
        userName: 'cmp-auto-map',
        resourceId: '900',
        detail: { carrierId: '5823382', via: 'name', companyName: 'ROAD WARRIORS TRANS INC' },
      }),
    );
  });

  it('a raced row (already mapped by something else) reports applied:false and never audits', async () => {
    applyAutoMapMock.mockResolvedValue(undefined);

    const res = await post('/v1/billing/transactions/auto-map', { transactionId: 900, carrierId: '5823382' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'success', transactionId: 900, applied: false });
    expect(auditMock).not.toHaveBeenCalled();
  });
});

describe('POST /v1/billing/ingest/payment — unchanged (regression pin)', () => {
  it('still requires the shared secret', async () => {
    const res = await post('/v1/billing/ingest/payment', { source: 'zelle', sourceRecordId: 'Z-1' }, 'wrong-secret');
    expect(res.statusCode).toBe(401);
    expect(upsertManyMock).not.toHaveBeenCalled();
  });

  it('still ingests a normal payment', async () => {
    const res = await post('/v1/billing/ingest/payment', { source: 'zelle', sourceRecordId: 'Z-1', amount: 500 });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'success', mapped: false });
    expect(upsertManyMock).toHaveBeenCalledTimes(1);
    expect(markIngestMappedMock).not.toHaveBeenCalled();
  });
});
