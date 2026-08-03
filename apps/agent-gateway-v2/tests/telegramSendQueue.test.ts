import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type TelegramModule = typeof import('../src/telegram.js');
let telegram: TelegramModule;
const fetchMock = vi.fn<typeof fetch>();

beforeAll(async () => {
  vi.stubEnv('TELEGRAM_BOT_TOKEN', 'test-token');
  vi.stubEnv('OPENAI_API_KEY', 'test-openai-key');
  vi.stubEnv('OCTANE_API_BASE', 'http://localhost:3000');
  vi.stubEnv('OCTANE_INTERNAL_API_KEY', 'test-internal-key');
  vi.stubGlobal('fetch', fetchMock);
  telegram = await import('../src/telegram.js');
});

beforeEach(() => fetchMock.mockReset());

describe('Telegram outbound queue', () => {
  it('sends a chat message without recursively deadlocking the global send lane', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const outcome = await Promise.race([
      telegram.sendMessage(-100123, 'salom').then(() => 'sent'),
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 250)),
    ]);

    expect(outcome).toBe('sent');
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/sendMessage');
  });

  it('surfaces Telegram API descriptions for failed sends', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: false, description: 'bot cannot send messages' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(telegram.sendMessage(-100123, 'salom')).rejects.toThrow(
      'bot cannot send messages',
    );
  });
});
