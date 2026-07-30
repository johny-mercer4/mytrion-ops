import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type MemoryModule = typeof import('../src/supportMemory.js');
let memory: MemoryModule;

beforeAll(async () => {
  vi.stubEnv('TELEGRAM_BOT_TOKEN', 'test-token');
  vi.stubEnv('OPENAI_API_KEY', 'test-openai-key');
  vi.stubEnv('OCTANE_API_BASE', 'http://localhost:3000');
  vi.stubEnv('OCTANE_INTERNAL_API_KEY', 'test-internal-key');
  memory = await import('../src/supportMemory.js');
});

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('gateway support memory adapter', () => {
  it('sends the complete per-user scope and renders recall as untrusted', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({
        carrierId: 'carrier-a',
        chatId: '-1001',
        telegramUserId: '9001',
        query: 'that issue',
      });
      return new Response(
        JSON.stringify({
          memories: [{ content: 'Prior sanitized turn', score: 0.91 }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const block = await memory.recallSupportMemory(
      { carrierId: 'carrier-a', chatId: -1001, telegramUserId: 9001 },
      'that issue',
    );

    expect(block).toContain('UNTRUSTED PER-USER MEMORY');
    expect(block).toContain('Prior sanitized turn');
  });

  it('keeps a successful turn successful when memory commit fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('down', { status: 503 })),
    );

    await expect(
      memory.commitSupportMemory(
        { carrierId: 'carrier-a', chatId: -1001, telegramUserId: 9001 },
        'question',
        'answer',
      ),
    ).resolves.toBeUndefined();
  });
});
