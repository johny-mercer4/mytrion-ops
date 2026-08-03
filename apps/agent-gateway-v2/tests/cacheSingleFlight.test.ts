import { beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('TELEGRAM_BOT_TOKEN', 'test-token');
  vi.stubEnv('OPENAI_API_KEY', 'test-openai-key');
  vi.stubEnv('OCTANE_API_BASE', 'http://localhost:3000');
  vi.stubEnv('OCTANE_INTERNAL_API_KEY', 'test-internal-key');
});

describe('backend cache refresh single-flight', () => {
  it('coalesces concurrent access-list refreshes for one carrier', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          users: [{ carrierId: 'carrier-1', telegramUserId: '42', profile: 'manager' }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { isRegistered, registeredRole } = await import('../src/access.js');

    const results = await Promise.all(
      Array.from({ length: 25 }, () => isRegistered('carrier-1', 42)),
    );
    expect(results.every(Boolean)).toBe(true);
    await expect(registeredRole('carrier-1', 42)).resolves.toBe('owner');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fails closed when an access-list profile is missing or unknown', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            users: [
              { carrierId: 'carrier-2', telegramUserId: '41' },
              { carrierId: 'carrier-2', telegramUserId: '42', profile: 'unexpected' },
              { carrierId: 'carrier-2', telegramUserId: '43', profile: 'driver' },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );
    const { registeredRole } = await import('../src/access.js');

    await expect(registeredRole('carrier-2', 41)).resolves.toBeNull();
    await expect(registeredRole('carrier-2', 42)).resolves.toBeNull();
    await expect(registeredRole('carrier-2', 43)).resolves.toBe('driver');
  });

  it('refreshes a bounded cache miss so a newly registered owner need not wait two minutes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-04T00:00:00.000Z'));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ users: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        users: [{ carrierId: 'carrier-3', telegramUserId: '44', profile: 'owner' }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const { registeredRole } = await import('../src/access.js');
      await expect(registeredRole('carrier-3', 44)).resolves.toBeNull();
      vi.advanceTimersByTime(15_000);
      await expect(registeredRole('carrier-3', 44)).resolves.toBe('owner');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('coalesces concurrent chat-map refreshes', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          chats: [{ chatId: '-1001', carrierId: 'carrier-1' }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { carrierFor } = await import('../src/chatMap.js');

    const results = await Promise.all(
      Array.from({ length: 25 }, () => carrierFor(-1001)),
    );
    expect(results).toEqual(Array.from({ length: 25 }, () => 'carrier-1'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
