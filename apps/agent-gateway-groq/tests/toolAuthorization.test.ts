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
});
