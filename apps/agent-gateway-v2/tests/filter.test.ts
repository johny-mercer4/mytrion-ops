import { describe, expect, it } from 'vitest';
import {
  engagementReason,
  isConversationActive,
  noteEngaged,
  shouldRouteAtIngress,
} from '../src/filter.js';
import type { TgMessage } from '../src/telegram.js';

function message(text: string, overrides: Partial<TgMessage> = {}): TgMessage {
  return {
    message_id: 1,
    chat: { id: -1001, type: 'supergroup' },
    from: { id: 9, first_name: 'Client' },
    text,
    ...overrides,
  };
}

describe('Telegram transport engagement state', () => {
  it('detects only Telegram-verifiable direct address', () => {
    expect(
      engagementReason(
        message('@OctaneSupportAgentBot completely novel wording'),
        'OctaneSupportAgentBot',
      ),
    ).toBe('mention');
    expect(
      engagementReason(
        message('any language', {
          reply_to_message: {
            message_id: 5,
            from: { username: 'OctaneSupportAgentBot', is_bot: true },
          },
        }),
        'OctaneSupportAgentBot',
      ),
    ).toBe('reply');
  });

  it('does not contain semantic keyword triggers', () => {
    expect(
      engagementReason(message('fuel report card decline'), 'Bot'),
    ).toBeNull();
    expect(
      engagementReason(message('ordinary team chatter'), 'Bot'),
    ).toBeNull();
  });

  it('tracks a verified active conversation per chat and user', () => {
    const followup = message('follow-up', {
      chat: { id: -2002, type: 'supergroup' },
      from: { id: 77, first_name: 'Client' },
    });
    noteEngaged(followup.chat.id, followup.from?.id ?? 0);
    expect(isConversationActive(-2002, 77)).toBe(true);
    expect(engagementReason(followup, 'Bot')).toBe('followup');
    expect(isConversationActive(-2002, 78)).toBe(false);
  });

  it('drops ambient chatter in the production-safe direct mode', () => {
    expect(shouldRouteAtIngress('direct', null)).toBe(false);
    expect(shouldRouteAtIngress('direct', 'mention')).toBe(true);
    expect(shouldRouteAtIngress('direct', 'reply')).toBe(true);
    expect(shouldRouteAtIngress('direct', 'followup')).toBe(true);
    expect(shouldRouteAtIngress('all_registered', null)).toBe(true);
  });
});
