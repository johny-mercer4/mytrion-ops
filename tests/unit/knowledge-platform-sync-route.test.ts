/**
 * POST /v1/knowledge/platform-sync — the production path for refreshing Horizon's self-knowledge.
 *
 * The nightly `maintenance.platform-knowledge-sync` cron cannot be enabled in production: cron
 * scheduling is not granular, so `FF_JOBS_ENABLED` would register 11 schedules at once, including
 * `notification.statement-weekly`, which sends fuel and money-code documents over Telegram to every
 * active mini-app registration with no first-run guard. This endpoint exists so a scheduler can
 * trigger only the sync.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { syncMock } = vi.hoisted(() => ({ syncMock: vi.fn() }));
vi.mock('../../src/modules/knowledge/platformSync.js', () => ({
  syncPlatformKnowledge: syncMock,
}));

import { buildApp } from '../../src/app.js';
import type { FastifyInstance } from 'fastify';

const PATH = '/v1/knowledge/platform-sync';
const KEY = process.env['API_KEY'] ?? 'test-secret-key';

let app: FastifyInstance;

beforeEach(async () => {
  syncMock.mockReset();
  syncMock.mockResolvedValue({ ready: 2, skipped: 44, updated: 0 });
  if (!app) {
    process.env.API_KEY ||= KEY;
    app = await buildApp();
    await app.ready();
  }
});

describe('POST /v1/knowledge/platform-sync', () => {
  it('refuses an unauthenticated caller', async () => {
    const res = await app.inject({ method: 'POST', url: PATH });
    expect([401, 403]).toContain(res.statusCode);
    expect(syncMock).not.toHaveBeenCalled();
  });

  it('runs the governed sync for an admin and returns the counts plus a duration', async () => {
    const res = await app.inject({
      method: 'POST',
      url: PATH,
      headers: { 'x-api-key': process.env['API_KEY'] ?? KEY },
    });
    expect(res.statusCode).toBe(200);
    expect(syncMock).toHaveBeenCalledTimes(1);
    const body = res.json() as { ready: number; skipped: number; durationMs: number };
    expect(body).toMatchObject({ ready: 2, skipped: 44, updated: 0 });
    expect(typeof body.durationMs).toBe('number');
  });

  /**
   * A scheduler that retries on timeout must not start a second embedding pass over the same corpus.
   * The work is idempotent, so the honest response is "already running" rather than a queue.
   */
  it('returns 409 rather than overlapping two syncs', async () => {
    let release: (() => void) | undefined;
    syncMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ ready: 0, skipped: 46, updated: 0 });
        }),
    );

    const first = app.inject({
      method: 'POST',
      url: PATH,
      headers: { 'x-api-key': process.env['API_KEY'] ?? KEY },
    });
    // Let the first request reach the in-flight guard before the second arrives.
    await vi.waitFor(() => expect(release).toBeDefined());

    const second = await app.inject({
      method: 'POST',
      url: PATH,
      headers: { 'x-api-key': process.env['API_KEY'] ?? KEY },
    });
    expect(second.statusCode).toBe(409);
    expect((second.json() as { error: { code: string } }).error.code).toBe('SYNC_IN_FLIGHT');

    release?.();
    expect((await first).statusCode).toBe(200);
    expect(syncMock).toHaveBeenCalledTimes(1);
  });

  it('clears the in-flight guard after a failure, so one bad run cannot wedge the endpoint', async () => {
    syncMock.mockRejectedValueOnce(new Error('embedding provider down'));
    const failed = await app.inject({
      method: 'POST',
      url: PATH,
      headers: { 'x-api-key': process.env['API_KEY'] ?? KEY },
    });
    expect(failed.statusCode).toBeGreaterThanOrEqual(500);

    const after = await app.inject({
      method: 'POST',
      url: PATH,
      headers: { 'x-api-key': process.env['API_KEY'] ?? KEY },
    });
    expect(after.statusCode).toBe(200);
  });
});

/**
 * `?rechunk=1` is the only way to roll a chunker or embedding-model change onto content that has not
 * changed: the ordinary skip is keyed on the document checksum, so a plain sync on the generated
 * catalog reports every document `skipped` and leaves the stored chunks exactly as they were. Verified
 * against the local corpus — a plain sync returned `{skipped: 46}` in 72ms and rotated nothing, while
 * `?rechunk=1` returned `{ready: 46}` in 11.7s and replaced every chunk row.
 */
describe('POST /v1/knowledge/platform-sync?rechunk=1', () => {
  it('does not re-chunk unless asked', async () => {
    const res = await app.inject({
      method: 'POST',
      url: PATH,
      headers: { 'x-api-key': process.env['API_KEY'] ?? KEY },
    });
    expect(res.statusCode).toBe(200);
    expect(syncMock).toHaveBeenCalledWith(expect.anything(), {});
    expect(res.json()).toMatchObject({ rechunk: false });
  });

  it('forwards rechunk for ?rechunk=1', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `${PATH}?rechunk=1`,
      headers: { 'x-api-key': process.env['API_KEY'] ?? KEY },
    });
    expect(res.statusCode).toBe(200);
    expect(syncMock).toHaveBeenCalledWith(expect.anything(), { rechunk: true });
    expect(res.json()).toMatchObject({ rechunk: true });
  });

  it('accepts ?rechunk=true as well', async () => {
    await app.inject({
      method: 'POST',
      url: `${PATH}?rechunk=true`,
      headers: { 'x-api-key': process.env['API_KEY'] ?? KEY },
    });
    expect(syncMock).toHaveBeenCalledWith(expect.anything(), { rechunk: true });
  });

  it('treats any other value as off, so a typo cannot trigger a full re-embed', async () => {
    for (const value of ['0', 'yes', 'RECHUNK', '']) {
      syncMock.mockClear();
      await app.inject({
        method: 'POST',
        url: `${PATH}?rechunk=${value}`,
        headers: { 'x-api-key': process.env['API_KEY'] ?? KEY },
      });
      expect(syncMock, `rechunk=${value}`).toHaveBeenCalledWith(expect.anything(), {});
    }
  });
});
