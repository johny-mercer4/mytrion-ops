import { beforeAll, describe, expect, it, vi } from 'vitest';

let buildOctaneTools: typeof import('../src/tools.js').buildOctaneTools;
let noteSender: typeof import('../src/tools.js').noteSender;

beforeAll(async () => {
  vi.stubEnv('TELEGRAM_BOT_TOKEN', 'test-token');
  vi.stubEnv('OPENAI_API_KEY', 'test-openai-key');
  vi.stubEnv('OCTANE_API_BASE', 'http://localhost:3000');
  vi.stubEnv('OCTANE_INTERNAL_API_KEY', 'test-internal-key');
  ({ buildOctaneTools, noteSender } = await import('../src/tools.js'));
});

describe('per-turn Telegram sender authorization', () => {
  it('rejects another recently-active member of the same group', () => {
    const chatId = -1001;
    noteSender(chatId, 9);
    noteSender(chatId, 10);
    const manifest = buildOctaneTools(chatId, 'carrier-1', 9).find(
      (tool) => tool.name === 'octane_whoami',
    );

    expect(manifest?.authorize?.({ telegram_user_id: 9 })).toBeNull();
    expect(manifest?.authorize?.({ telegram_user_id: 10 })).toBe(
      'refused: telegram_user_id does not match the current message sender',
    );
  });

  it('binds the Card Lookup report to the current sender and report endpoint', async () => {
    const fetchCalls: Array<{ input: string | URL | Request; init?: RequestInit }> = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      fetchCalls.push({ input, init });
      return new Response(JSON.stringify({ sent: true, rows: 2 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const chatId = -1002;
    const userId = 11;
    noteSender(chatId, userId);
    const manifest = buildOctaneTools(chatId, 'carrier-2', userId).find(
      (tool) => tool.name === 'octane_card_lookup_report',
    );

    expect(manifest?.riskClass).toBe('write');
    expect(manifest?.confirmationMode).toBeUndefined();
    await manifest?.execute({ telegram_user_id: userId, format: 'xlsx' });
    expect(String(fetchCalls[0]?.input)).toBe(
      'http://localhost:3000/v1/support-bot/card-lookup-report',
    );
    expect(JSON.parse(String(fetchCalls[0]?.init?.body))).toMatchObject({
      carrierId: 'carrier-2',
      telegramUserId: String(userId),
      format: 'xlsx',
    });
  });

  it('allows buttons only for a complete supported write confirmation', () => {
    const manifest = buildOctaneTools(-1003, 'carrier-3', 12).find(
      (tool) => tool.name === 'telegram_buttons',
    );

    expect(
      manifest?.validate?.({
        text: 'Shoshilinchlikni tanlang',
        buttons: [
          { label: '🔴 Shoshilinch', data: 'urgent' },
          { label: '🟡 Oddiy', data: 'normal' },
        ],
      }).ok,
    ).toBe(false);
    expect(
      manifest?.validate?.({
        text: 'Kartani o‘chiraymi?',
        confirmation: {
          tool_name: 'octane_card_action',
          arguments: { card_last6: '087937', action: 'deactivate' },
        },
      }).ok,
    ).toBe(true);
  });

  it('removes callback tickets and accepts exact unit report scope', () => {
    const tools = buildOctaneTools(-1004, 'carrier-4', 13);
    const serviceRequest = tools.find(
      (tool) => tool.name === 'octane_service_request',
    );
    const report = tools.find((tool) => tool.name === 'octane_txn_report');

    expect(
      serviceRequest?.validate?.({
        telegram_user_id: 13,
        request: 'callback',
        comment: 'Call me urgently',
      }).ok,
    ).toBe(false);
    expect(
      report?.validate?.({
        telegram_user_id: 13,
        range: 'week',
        format: 'xlsx',
        unit_number: '040',
      }).ok,
    ).toBe(true);
  });
});
