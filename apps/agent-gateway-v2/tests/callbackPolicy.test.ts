import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  answerCallback: vi.fn(async () => undefined),
  carrierFor: vi.fn(async () => 'carrier-a'),
  clearButtons: vi.fn(async () => undefined),
  groupBinding: vi.fn(async () => false),
  registeredRole: vi.fn(async () => 'owner'),
}));

vi.mock('../src/access.js', () => ({ registeredRole: mocks.registeredRole }));
vi.mock('../src/chatMap.js', () => ({ carrierFor: mocks.carrierFor }));
vi.mock('../src/groupBinding.js', () => ({
  handleGroupBindingCallback: mocks.groupBinding,
}));
vi.mock('../src/filter.js', () => ({ noteEngaged: vi.fn() }));
vi.mock('../src/messageLog.js', () => ({ logMessage: vi.fn() }));
vi.mock('../src/requestAdmission.js', () => ({ tryAdmitRequest: vi.fn() }));
vi.mock('../src/sessions.js', () => ({ enqueueConfirmedTurn: vi.fn() }));
vi.mock('../src/tools.js', () => ({ noteSender: vi.fn() }));
vi.mock('../src/turnTelemetry.js', () => ({
  logTurn: vi.fn(),
  sendOverloadReply: vi.fn(),
  stampElapsed: vi.fn(),
}));
vi.mock('../src/telegram.js', () => ({
  answerCallback: mocks.answerCallback,
  clearButtons: mocks.clearButtons,
  sendMessage: vi.fn(),
  sendTyping: vi.fn(),
}));

import { handleCallback } from '../src/callbackHandler.js';
import type { TgUpdate } from '../src/telegram.js';

describe('Telegram callback policy', () => {
  it('rejects legacy arbitrary-choice buttons before access, routing, or model work', async () => {
    const flushBurst = vi.fn(async () => undefined);
    const update = {
      update_id: 91,
      callback_query: {
        id: 'callback-urgent',
        from: { id: 7001, first_name: 'Layla' },
        data: 'urgent',
        message: {
          message_id: 551,
          chat: { id: -1003949854556, type: 'supergroup' },
          date: 0,
        },
      },
    } as TgUpdate;

    await expect(handleCallback(update, flushBurst)).resolves.toBe(true);

    expect(mocks.clearButtons).toHaveBeenCalledWith(-1003949854556, 551);
    expect(mocks.answerCallback).toHaveBeenCalledWith(
      'callback-urgent',
      'This button is no longer available.',
      true,
    );
    expect(mocks.carrierFor).not.toHaveBeenCalled();
    expect(mocks.registeredRole).not.toHaveBeenCalled();
    expect(flushBurst).not.toHaveBeenCalled();
  });
});
