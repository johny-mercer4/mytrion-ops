/**
 * POST /v1/ringcentral/call-events → mytrion_calls persistence. Pins the rules that turn a
 * RingCentral call-end event into a call-log row: only finished OUTBOUND calls with a source
 * are logged; source precedence (retention_case → lead → deal); picked_up/missed derivation;
 * caller resolved from the zoho: principal; startTime → callTime.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.API_KEY = 'test-secret-key';
});

const { createMock } = vi.hoisted(() => ({ createMock: vi.fn(async () => ({ id: 'mc_1' })) }));
vi.mock('../../src/repos/mytrionCallRepo.js', () => ({ mytrionCallRepo: { create: createMock } }));
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
beforeEach(() => createMock.mockClear());

async function danielToken(): Promise<string> {
  return signAccessToken({
    userId: 'zoho:6227679000031473048',
    tenantId: DEFAULT_TENANT_ID,
    audience: 'internal',
    role: 'admin', // stale — re-derived to worker at verify
    worker: { zohoUserId: '6227679000031473048', userName: 'Daniel Brown', profile: 'Sales Agent' },
  });
}

async function post(body: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url: '/v1/ringcentral/call-events',
    headers: { authorization: `Bearer ${await danielToken()}`, 'content-type': 'application/json' },
    payload: body,
  });
}

const ENDED_LEAD = {
  kind: 'ended',
  direction: 'Outbound',
  to: '+15551234567',
  durationMs: 42_000,
  result: 'Call connected',
  sessionId: 's1',
  startTime: '2026-07-21T15:00:00.000Z',
  leadId: 'LEAD1',
};

describe('mytrion_calls persistence', () => {
  it('logs a finished outbound lead call with derived fields', async () => {
    const res = await post(ENDED_LEAD);
    expect(res.statusCode).toBe(202);
    expect(createMock).toHaveBeenCalledTimes(1);
    const [, row] = createMock.mock.calls[0]!;
    expect(row).toMatchObject({
      callerZohoUserId: '6227679000031473048',
      phoneNumber: '+15551234567',
      durationSeconds: 42,
      callStatus: 'picked_up',
      sourceType: 'lead',
      sourceId: 'LEAD1',
      sessionId: 's1',
      direction: 'Outbound',
    });
    expect((row.callTime as Date).toISOString()).toBe('2026-07-21T15:00:00.000Z');
  });

  it('marks a zero-duration, unconnected call as missed', async () => {
    await post({ ...ENDED_LEAD, durationMs: 0, result: 'No Answer' });
    expect(createMock.mock.calls[0]![1]).toMatchObject({ callStatus: 'missed', durationSeconds: 0 });
  });

  it('source precedence: retention_case wins over a co-present dealId', async () => {
    await post({ ...ENDED_LEAD, leadId: undefined, dealId: 'DEAL1', retentionCaseId: 'CASE1' });
    expect(createMock.mock.calls[0]![1]).toMatchObject({ sourceType: 'retention_case', sourceId: 'CASE1' });
  });

  it('logs a deal call as source_type deal', async () => {
    await post({ ...ENDED_LEAD, leadId: undefined, dealId: 'DEAL1' });
    expect(createMock.mock.calls[0]![1]).toMatchObject({ sourceType: 'deal', sourceId: 'DEAL1' });
  });

  it('does NOT log inbound, non-ended, or source-less calls', async () => {
    await post({ ...ENDED_LEAD, direction: 'Inbound' });
    await post({ ...ENDED_LEAD, kind: 'connected' });
    await post({ kind: 'ended', direction: 'Outbound', to: '+1555', durationMs: 10 }); // no source ids
    expect(createMock).not.toHaveBeenCalled();
  });
});
