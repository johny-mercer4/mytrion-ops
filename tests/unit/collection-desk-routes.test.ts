/**
 * Collection desk WRITE routes — the RBAC boundary, the validation, and the two guards that stop
 * a case being placed or closed twice.
 *
 * Every repo is mocked: this asserts the route contract (who may call it, what shapes are
 * accepted, what gets written to the timeline), not Postgres. The lane logic those writes feed
 * has its own file, `collection-desk-policy.test.ts`.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.API_KEY = 'test-secret-key';
});

vi.mock('../../src/repos/collectionCaseRepo.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/repos/collectionCaseRepo.js')>();
  return {
    ...actual,
    collectionCaseRepo: {
      list: vi.fn(),
      findById: vi.fn(),
      listInvoices: vi.fn(),
      setStage: vi.fn(),
      close: vi.fn(),
      reopen: vi.fn(),
      markPlaced: vi.fn(),
    },
  };
});

vi.mock('../../src/repos/collectionActivityRepo.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/repos/collectionActivityRepo.js')>();
  return {
    ...actual,
    collectionActivityRepo: {
      listByCase: vi.fn(),
      lastContactByCase: vi.fn(),
      insert: vi.fn(),
    },
  };
});

vi.mock('../../src/repos/collectionPlanRepo.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/repos/collectionPlanRepo.js')>();
  return {
    ...actual,
    collectionPlanRepo: {
      listPromises: vi.fn(),
      openPromisesByCase: vi.fn(),
      createPromise: vi.fn(),
      resolvePromise: vi.fn(),
      activePlan: vi.fn(),
      planProgressByCase: vi.fn(),
      createPlan: vi.fn(),
      closePlan: vi.fn(),
      setInstalmentStatus: vi.fn(),
      sweepOverdue: vi.fn(),
    },
  };
});

vi.mock('../../src/modules/audit/auditLogger.js', () => ({
  auditFromContext: vi.fn(async () => undefined),
}));

import { buildApp } from '../../src/app.js';
import { DEFAULT_TENANT_ID } from '../../src/config/constants.js';
import { signAccessToken } from '../../src/modules/auth/jwt.js';
import { auditFromContext } from '../../src/modules/audit/auditLogger.js';
import { collectionActivityRepo } from '../../src/repos/collectionActivityRepo.js';
import { collectionCaseRepo } from '../../src/repos/collectionCaseRepo.js';
import { collectionPlanRepo } from '../../src/repos/collectionPlanRepo.js';

const findById = vi.mocked(collectionCaseRepo.findById);
const setStage = vi.mocked(collectionCaseRepo.setStage);
const closeCase = vi.mocked(collectionCaseRepo.close);
const markPlaced = vi.mocked(collectionCaseRepo.markPlaced);
const insertActivity = vi.mocked(collectionActivityRepo.insert);
const createPromise = vi.mocked(collectionPlanRepo.createPromise);
const createPlan = vi.mocked(collectionPlanRepo.createPlan);
const activePlan = vi.mocked(collectionPlanRepo.activePlan);
const audit = vi.mocked(auditFromContext);

const OPEN_CASE = {
  id: 'cc_1',
  carrierId: '5104821',
  status: 'open' as const,
  collectionStage: 'connected' as const,
  totalDebtAmount: '26120',
  placementDate: null,
  closedReason: null,
};

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the route reads five fields of the DTO
  findById.mockResolvedValue(OPEN_CASE as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ditto for the write results
  setStage.mockImplementation(async (_id, stage) => ({ ...OPEN_CASE, collectionStage: stage }) as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  closeCase.mockResolvedValue({ ...OPEN_CASE, status: 'closed' } as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  markPlaced.mockResolvedValue({ ...OPEN_CASE, placementDate: '2026-08-19' } as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  insertActivity.mockImplementation(async (entry) => ({ id: 'cla_1', ...entry }) as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createPromise.mockResolvedValue({ id: 'clp_1', caseId: 'cc_1', amount: '2400.00', dueDate: '2026-08-26' } as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createPlan.mockResolvedValue({ id: 'cpp_1', caseId: 'cc_1', supersedesPlanId: null, instalments: [] } as any);
  activePlan.mockResolvedValue(null);
});

async function workerToken(profile: string, tenantId = DEFAULT_TENANT_ID): Promise<string> {
  return signAccessToken({
    userId: 'zoho:42',
    tenantId,
    audience: 'internal',
    role: 'admin',
    worker: { zohoUserId: '42', userName: 'Dina Carter', profile },
  });
}

const bearer = (t: string): Record<string, string> => ({ authorization: `Bearer ${t}` });

describe('write RBAC', () => {
  const writes: Array<[string, Record<string, unknown>]> = [
    ['/v1/collection/cases/cc_1/contact', { channel: 'call', outcome: 'reached' }],
    ['/v1/collection/cases/cc_1/promises', { amount: '100.00', dueDate: '2026-09-01' }],
    ['/v1/collection/cases/cc_1/stage', { stage: 'payment_plan' }],
    ['/v1/collection/cases/cc_1/close', { reason: 'manual' }],
    ['/v1/collection/cases/cc_1/notes', { note: 'hello' }],
  ];

  it('refuses every write unauthenticated', async () => {
    for (const [url, payload] of writes) {
      const res = await app.inject({ method: 'POST', url, payload });
      expect(res.statusCode, url).toBe(401);
    }
    expect(insertActivity).not.toHaveBeenCalled();
  });

  it('refuses a worker who does not hold Collection', async () => {
    const headers = bearer(await workerToken('Verification'));
    for (const [url, payload] of writes) {
      const res = await app.inject({ method: 'POST', url, payload, headers });
      expect(res.statusCode, url).toBe(403);
    }
    expect(insertActivity).not.toHaveBeenCalled();
  });

  it('refuses a rival tenant even with the department — the case is simply not found', async () => {
    findById.mockResolvedValue(undefined);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/collection/cases/cc_1/contact',
      payload: { channel: 'call', outcome: 'reached' },
      headers: bearer(await workerToken('Collection', 'rival-tenant')),
    });
    expect(res.statusCode).toBe(404);
    expect(insertActivity).not.toHaveBeenCalled();
  });
});

describe('logging a contact', () => {
  it('writes one timeline entry and audits it', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/collection/cases/cc_1/contact',
      payload: { channel: 'call', outcome: 'no_answer', note: 'Voicemail on the cell.' },
      headers: bearer(await workerToken('Collection')),
    });
    expect(res.statusCode).toBe(201);
    expect(insertActivity).toHaveBeenCalledTimes(1);
    expect(insertActivity.mock.calls[0]?.[0]).toMatchObject({
      caseId: 'cc_1',
      kind: 'contact',
      channel: 'call',
      outcome: 'no_answer',
      summary: 'Call — no answer',
      actorName: 'Dina Carter',
    });
    expect(createPromise).not.toHaveBeenCalled();
    expect(audit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'collection.contact.log' }),
    );
  });

  it('takes the promise made on the same call, as its own row plus a timeline entry', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/collection/cases/cc_1/contact',
      payload: {
        channel: 'call',
        outcome: 'reached',
        promise: { amount: '2400.00', dueDate: '2026-08-26' },
      },
      headers: bearer(await workerToken('Collection')),
    });
    expect(res.statusCode).toBe(201);
    expect(createPromise).toHaveBeenCalledWith(
      expect.objectContaining({ caseId: 'cc_1', amount: '2400.00', dueDate: '2026-08-26' }),
    );
    expect(insertActivity).toHaveBeenCalledTimes(2);
    expect(insertActivity.mock.calls[1]?.[0]).toMatchObject({ kind: 'promise', amount: '2400.00' });
  });

  it('rejects a float-shaped amount and a bare date', async () => {
    const headers = bearer(await workerToken('Collection'));
    for (const promise of [{ amount: '24.001', dueDate: '2026-08-26' }, { amount: '24.00', dueDate: '26/08/2026' }]) {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/collection/cases/cc_1/contact',
        payload: { channel: 'call', outcome: 'reached', promise },
        headers,
      });
      expect(res.statusCode).toBe(400);
    }
    expect(createPromise).not.toHaveBeenCalled();
  });
});

describe('payment plan', () => {
  it('moves the case onto the payment_plan stage in the same call', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/collection/cases/cc_1/plan',
      payload: {
        instalmentAmount: '2400.00',
        instalmentCount: 8,
        frequency: 'monthly',
        firstPaymentDate: '2026-09-02',
      },
      headers: bearer(await workerToken('Collection')),
    });
    expect(res.statusCode).toBe(201);
    expect(createPlan).toHaveBeenCalledTimes(1);
    expect(setStage).toHaveBeenCalledWith('cc_1', 'payment_plan');
    const kinds = insertActivity.mock.calls.map((c) => c[0]?.kind);
    expect(kinds).toEqual(['stage', 'plan']);
  });

  it('refuses to start a plan on a closed case', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    findById.mockResolvedValue({ ...OPEN_CASE, status: 'closed' } as any);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/collection/cases/cc_1/plan',
      payload: {
        instalmentAmount: '2400.00',
        instalmentCount: 8,
        frequency: 'monthly',
        firstPaymentDate: '2026-09-02',
      },
      headers: bearer(await workerToken('Collection')),
    });
    expect(res.statusCode).toBe(400);
    expect(createPlan).not.toHaveBeenCalled();
  });
});

describe('the two double-action guards', () => {
  it('refuses to place a case that already carries a placement date', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    findById.mockResolvedValue({ ...OPEN_CASE, placementDate: '2026-07-01' } as any);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/collection/cases/cc_1/placement',
      payload: { agency: 'Array Recovery', placementDate: '2026-08-19' },
      headers: bearer(await workerToken('Collection')),
    });
    expect(res.statusCode).toBe(400);
    expect(markPlaced).not.toHaveBeenCalled();
  });

  it('refuses to close a case that is already closed', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    findById.mockResolvedValue({ ...OPEN_CASE, status: 'closed' } as any);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/collection/cases/cc_1/close',
      payload: { reason: 'case_lost', writeOffAmount: '26120.00' },
      headers: bearer(await workerToken('Collection')),
    });
    expect(res.statusCode).toBe(400);
    expect(closeCase).not.toHaveBeenCalled();
  });

  it('case_lost lands on the case_lost stage, every other reason on closed_successfully', async () => {
    const headers = bearer(await workerToken('Collection'));
    await app.inject({
      method: 'POST',
      url: '/v1/collection/cases/cc_1/close',
      payload: { reason: 'case_lost' },
      headers,
    });
    expect(closeCase).toHaveBeenCalledWith('cc_1', { reason: 'case_lost', stage: 'case_lost' });
    closeCase.mockClear();
    await app.inject({
      method: 'POST',
      url: '/v1/collection/cases/cc_1/close',
      payload: { reason: 'paid_in_full' },
      headers,
    });
    expect(closeCase).toHaveBeenCalledWith('cc_1', {
      reason: 'paid_in_full',
      stage: 'closed_successfully',
    });
  });

  it('rejects a closed reason that is not in the enum', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/collection/cases/cc_1/close',
      payload: { reason: 'gave_up' },
      headers: bearer(await workerToken('Collection')),
    });
    expect(res.statusCode).toBe(400);
    expect(closeCase).not.toHaveBeenCalled();
  });
});

describe('stage moves', () => {
  it('is a no-op when the case is already on that stage', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/collection/cases/cc_1/stage',
      payload: { stage: 'connected' },
      headers: bearer(await workerToken('Collection')),
    });
    expect(res.statusCode).toBe(200);
    expect(setStage).not.toHaveBeenCalled();
    expect(insertActivity).not.toHaveBeenCalled();
  });

  it('records where it moved from as well as to', async () => {
    await app.inject({
      method: 'POST',
      url: '/v1/collection/cases/cc_1/stage',
      payload: { stage: 'skip_tracing' },
      headers: bearer(await workerToken('Collection')),
    });
    expect(insertActivity.mock.calls[0]?.[0]).toMatchObject({
      kind: 'stage',
      summary: 'Stage Connected → Skip tracing',
      meta: { from: 'connected', to: 'skip_tracing' },
    });
  });
});
