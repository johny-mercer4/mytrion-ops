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
          users: [{ telegramUserId: '42', profile: 'manager' }],
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
              { telegramUserId: '41' },
              { telegramUserId: '42', profile: 'unexpected' },
              { telegramUserId: '43', profile: 'driver' },
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
