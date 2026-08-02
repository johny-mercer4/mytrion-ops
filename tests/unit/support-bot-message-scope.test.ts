import { describe, expect, it } from 'vitest';
import { assertSupportBotMessageScope } from '../../src/modules/carrier/supportBotMessageScope.js';

describe('support-bot message carrier isolation', () => {
  const chats = [
    { chatId: '-1001', carrierId: 'carrier-a', enabled: true },
    { chatId: '-1002', carrierId: 'carrier-b', enabled: false },
  ];

  it('accepts only an exact enabled chat/carrier mapping', () => {
    expect(() => assertSupportBotMessageScope([
      { chatId: '-1001', carrierId: 'carrier-a' },
    ], chats)).not.toThrow();
  });

  it.each([
    [{ chatId: '-1001', carrierId: 'carrier-b' }, 'mixed carrier'],
    [{ chatId: '-1002', carrierId: 'carrier-b' }, 'disabled chat'],
    [{ chatId: '-1999', carrierId: 'carrier-a' }, 'unknown chat'],
  ] as const)('rejects %s (%s)', (message, _label) => {
    expect(() => assertSupportBotMessageScope([message], chats)).toThrow(
      expect.objectContaining({ statusCode: 403, code: 'SUPPORT_BOT_MESSAGE_SCOPE_MISMATCH' }),
    );
  });
});
