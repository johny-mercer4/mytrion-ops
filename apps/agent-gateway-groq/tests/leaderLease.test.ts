import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/config.js', () => ({
  config: {
    gatewayLeaseEnabled: true,
    gatewayLeaseTtlSeconds: 45,
    gatewayLeaseRenewMs: 60_000,
    botIdentity: 'octane-bot',
    octaneBase: 'http://localhost:3000',
    octaneSupportBotKey: 'support-key',
  },
}));

import { startGatewayLeaderLease } from '../src/leaderLease.js';

function response(body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('gateway leader lease client', () => {
  beforeEach(() => vi.stubEnv('GATEWAY_INSTANCE_ID', 'instance-a'));
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('polls only after acquiring and releases the exact fenced lease on shutdown', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, _init?: RequestInit) =>
      String(input).endsWith('/release')
        ? response({ released: true })
        : response({
            acquired: true,
            fencingToken: 7,
            expiresAt: new Date(Date.now() + 45_000).toISOString(),
          }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const lease = await startGatewayLeaderLease();

    expect(lease.isLeader()).toBe(true);
    expect(lease.pollSignal.aborted).toBe(false);
    await lease.stop();
    expect(lease.pollSignal.aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const acquireBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    const releaseBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as Record<string, unknown>;
    expect(acquireBody['holderId']).toMatch(/^instance-a:\d+:[0-9a-f-]{36}$/u);
    expect(releaseBody).toEqual({
      botIdentity: 'octane-bot',
      holderId: acquireBody['holderId'],
      fencingToken: 7,
    });
  });

  it('uses a conservative local deadline instead of trusting backend clock skew', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({
      acquired: true,
      fencingToken: 8,
      expiresAt: new Date(0).toISOString(),
    })));
    const lease = await startGatewayLeaderLease();

    expect(lease.isLeader()).toBe(true);
    await lease.stop();
  });

  it('keeps a non-holder standby from opening a Telegram poll', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({
      acquired: false,
      fencingToken: 9,
      expiresAt: new Date(Date.now() + 45_000).toISOString(),
    })));
    const lease = await startGatewayLeaderLease();

    expect(lease.isLeader()).toBe(false);
    expect(lease.pollSignal.aborted).toBe(true);
    await lease.stop();
  });
});
