/**
 * "Refresh scoring" must ENQUEUE, never run inline.
 *
 * A full run takes ~77 seconds against the warehouse. The first version of this route awaited
 * `runScoring` inside the request, so any button wired to it would hit the proxy timeout and report
 * failure while the run carried on to completion — the worst of both: the user retries, and the
 * queue is the only thing stopping a stampede.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const triggerCatalogJob = vi.fn();
const runScoring = vi.fn();

vi.mock('../../src/modules/jobs/adminTrigger.js', () => ({
  triggerCatalogJob: (...a: unknown[]) => triggerCatalogJob(...a),
}));
vi.mock('../../src/modules/mytrionWatch/watchService.js', () => ({
  watchService: {
    runScoring: (...a: unknown[]) => runScoring(...a),
    queue: vi.fn().mockResolvedValue({ scoringDate: null, items: [], total: 0, aggregates: {}, lastRun: null }),
    carrier: vi.fn().mockResolvedValue({}),
    runs: vi.fn().mockResolvedValue([]),
  },
}));

const { buildApp } = await import('../../src/app.js');
const { signAccessToken } = await import('../../src/modules/auth/jwt.js');
const { DEFAULT_TENANT_ID } = await import('../../src/config/constants.js');

const app = await buildApp();
await app.ready();

const worker = (profile: string) =>
  signAccessToken({
    userId: 'zoho:42',
    tenantId: DEFAULT_TENANT_ID,
    audience: 'internal',
    role: 'admin',
    worker: { zohoUserId: '42', userName: 'T', profile },
  });
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
const post = async (token: string) =>
  app.inject({ method: 'POST', url: '/v1/verification/watch/run', headers: bearer(token), payload: {} });

beforeEach(() => {
  triggerCatalogJob.mockReset().mockResolvedValue({ jobId: 'job_1', name: 'automation.verification.watch-scoring' });
  runScoring.mockReset();
});

describe('POST /verification/watch/run', () => {
  it('queues the job and answers 202 — accepted, not done', async () => {
    const res = await post(await worker('Verification'));
    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({ queued: true, jobId: 'job_1' });
  });

  it('NEVER scores inline — that is a 77-second request', async () => {
    await post(await worker('Verification'));
    expect(triggerCatalogJob).toHaveBeenCalledWith(
      'automation.verification.watch-scoring',
      expect.objectContaining({ trigger: 'manual' }),
    );
    expect(runScoring).not.toHaveBeenCalled();
  });

  it('is a desk action, not an admin one — a verification worker may refresh', async () => {
    // Safe to expose because the queue is a singleton: two agents pressing it collapse into one run.
    expect((await post(await worker('Verification'))).statusCode).toBe(202);
  });

  it('refuses a Sales worker', async () => {
    expect((await post(await worker('Sales Rep'))).statusCode).toBe(403);
    expect(triggerCatalogJob).not.toHaveBeenCalled();
  });

  it('refuses unauthenticated', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/verification/watch/run', payload: {} });
    expect(res.statusCode).toBe(401);
    expect(triggerCatalogJob).not.toHaveBeenCalled();
  });
});
