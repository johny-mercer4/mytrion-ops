import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

let buildOctaneTools: typeof import('../src/tools.js').buildOctaneTools;
let noteSender: typeof import('../src/tools.js').noteSender;

beforeAll(async () => {
  vi.stubEnv('TELEGRAM_BOT_TOKEN', 'test-token');
  vi.stubEnv('OPENAI_API_KEY', 'test-openai-key');
  vi.stubEnv('OCTANE_API_BASE', 'http://localhost:3000');
  vi.stubEnv('OCTANE_SUPPORT_BOT_API_KEY', 'test-support-key');
  vi.stubEnv('OCTANE_TENANT_ID', 'tenant-a');
  ({ buildOctaneTools, noteSender } = await import('../src/tools.js'));
});

describe('confirmed mutation transport identity', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('adds one stable fence and distinct idempotency metadata to every business mutation', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
      const url = String(input);
      return new Response(
        JSON.stringify(
          url.endsWith('/support-bot/session-fence')
            ? { enabled: true, fencingToken: 12 }
            : { success: true },
        ),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    const chatId = -1001;
    const userId = 9001;
    noteSender(chatId, userId);
    const tools = buildOctaneTools(
      chatId,
      'carrier-a',
      userId,
      'confirmation:sbcf_abc',
      'sbcf_abc',
    );
    const cases: Array<[string, Record<string, unknown>]> = [
      ['octane_money_code', { telegram_user_id: userId, amount: 500, unit_number: '12', reason: 'fuel' }],
      ['octane_card_action', { telegram_user_id: userId, card_last6: '123456', action: 'deactivate' }],
      ['octane_card_limits', { telegram_user_id: userId, card_last6: '123456', limit_id: 'ULSD', action: 'increase', value: 5 }],
      ['octane_card_info', { telegram_user_id: userId, unit_number: 'UNIT-7' }],
      ['octane_service_request', { telegram_user_id: userId, request: 'general-support', comment: 'Need help' }],
      ['octane_override', { telegram_user_id: userId }],
    ];

    for (const [name, args] of cases) {
      const manifest = tools.find((candidate) => candidate.name === name);
      expect(manifest?.confirmationMode).toBe('trusted_button');
      await expect(manifest?.execute(args)).resolves.toBeDefined();
    }

    const calls = fetchMock.mock.calls.map(([input, init]) => ({
      url: String(input),
      headers: new Headers(init?.headers),
    }));
    expect(calls.filter((call) => call.url.endsWith('/support-bot/session-fence'))).toHaveLength(1);
    const mutations = calls.filter((call) => !call.url.endsWith('/support-bot/session-fence'));
    expect(mutations.map((call) => new URL(call.url).pathname)).toEqual([
      '/v1/support-bot/money-code/draw',
      '/v1/support-bot/card-action',
      '/v1/support-bot/card-limits',
      '/v1/support-bot/card-info',
      '/v1/support-bot/service-request',
      '/v1/support-bot/override',
    ]);
    mutations.forEach((call, occurrence) => {
      expect(call.headers.get('idempotency-key')).toMatch(/^[a-f0-9]{64}$/u);
      expect(call.headers.get('x-support-bot-confirmation-id')).toBe('sbcf_abc');
      expect(call.headers.get('x-support-bot-turn-id')).toBe('confirmation:sbcf_abc');
      expect(call.headers.get('x-support-bot-write-occurrence')).toBe(String(occurrence));
      expect(call.headers.get('x-support-bot-fencing-token')).toBe('12');
      expect(call.headers.get('x-support-bot-key')).toBe('test-support-key');
    });
    expect(new Set(mutations.map((call) => call.headers.get('idempotency-key'))).size).toBe(6);
  });
});
