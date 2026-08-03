import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  canPrompt: vi.fn(() => true),
  preview: vi.fn(),
  confirm: vi.fn(),
  release: vi.fn(),
  sendButtons: vi.fn(),
  answerCallback: vi.fn(async () => undefined),
  clearButtons: vi.fn(async () => undefined),
  sendMessage: vi.fn(async () => undefined),
}));

vi.mock('../src/chatMap.js', () => ({
  canPromptAutoBind: mocks.canPrompt,
  previewAutoBind: mocks.preview,
  confirmAutoBind: mocks.confirm,
  releaseAutoBindPrompt: mocks.release,
}));
vi.mock('../src/telegram.js', () => ({
  sendButtons: mocks.sendButtons,
  answerCallback: mocks.answerCallback,
  clearButtons: mocks.clearButtons,
  sendMessage: mocks.sendMessage,
}));

function callback(input: {
  data: string;
  userId: number;
  chatId?: number;
  messageId?: number;
  callbackId?: string;
}) {
  return {
    update_id: 101,
    callback_query: {
      id: input.callbackId ?? 'callback-1',
      from: { id: input.userId, first_name: 'Owner' },
      message: {
        message_id: input.messageId ?? 501,
        chat: { id: input.chatId ?? -1001 },
      },
      data: input.data,
    },
  };
}

function latestButtonData(index: number): string {
  const buttons = mocks.sendButtons.mock.calls.at(-1)?.[2] as
    | Array<{ data?: unknown }>
    | undefined;
  const data = buttons?.[index]?.data;
  if (typeof data !== 'string') throw new Error(`Missing test button at index ${index}`);
  return data;
}

describe('owner/manager group binding confirmation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.canPrompt.mockReturnValue(true);
    mocks.sendButtons.mockResolvedValue(501);
    mocks.confirm.mockResolvedValue({
      carrierId: 'carrier-a',
      companyName: 'Fleet A',
      bound: true,
    });
  });

  it.each(['owner', 'manager'] as const)(
    'shows the server-resolved company for an active %s and writes only after Yes',
    async (profile) => {
      mocks.preview.mockResolvedValue({
        carrierId: 'carrier-a',
        companyName: 'Fleet A',
        profile,
      });
      const {
        handleGroupBindingCallback,
        requestGroupBindingConfirmation,
      } = await import('../src/groupBinding.js');

      await expect(requestGroupBindingConfirmation({
        chatId: -1001,
        telegramUserId: 9001,
        replyToMessageId: 77,
      })).resolves.toBe(true);
      expect(mocks.sendButtons).toHaveBeenCalledWith(
        -1001,
        expect.stringContaining('Fleet A'),
        expect.arrayContaining([
          expect.objectContaining({ label: expect.stringContaining('Yes') }),
          expect.objectContaining({ label: expect.stringContaining('No') }),
        ]),
        77,
      );
      expect(mocks.confirm).not.toHaveBeenCalled();

      await expect(handleGroupBindingCallback(callback({
        data: latestButtonData(0),
        userId: 9001,
      }))).resolves.toBe(true);
      expect(mocks.confirm).toHaveBeenCalledWith(-1001, 9001);
      expect(mocks.sendMessage).toHaveBeenCalledWith(
        -1001,
        expect.stringContaining('Fleet A'),
        501,
      );
    },
  );

  it('does not let another group member consume the owner confirmation', async () => {
    mocks.preview.mockResolvedValue({
      carrierId: 'carrier-b',
      companyName: 'Fleet B',
      profile: 'owner',
    });
    mocks.confirm.mockResolvedValue({
      carrierId: 'carrier-b',
      companyName: 'Fleet B',
      bound: true,
    });
    mocks.sendButtons.mockResolvedValue(502);
    const { handleGroupBindingCallback, requestGroupBindingConfirmation } =
      await import('../src/groupBinding.js');
    await requestGroupBindingConfirmation({
      chatId: -1002,
      telegramUserId: 9002,
      replyToMessageId: 78,
    });
    await handleGroupBindingCallback(callback({
      data: latestButtonData(0),
      userId: 9999,
      chatId: -1002,
      messageId: 502,
    }));
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(mocks.answerCallback).toHaveBeenCalledWith(
      'callback-1',
      expect.stringContaining('Only the owner or manager'),
      true,
    );

    await handleGroupBindingCallback(callback({
      data: latestButtonData(0),
      userId: 9002,
      chatId: -1002,
      messageId: 502,
      callbackId: 'callback-2',
    }));
    expect(mocks.confirm).toHaveBeenCalledWith(-1002, 9002);
  });

  it('cancels without writing a group mapping', async () => {
    mocks.preview.mockResolvedValue({
      carrierId: 'carrier-c',
      companyName: 'Fleet C',
      profile: 'manager',
    });
    mocks.sendButtons.mockResolvedValue(503);
    const { handleGroupBindingCallback, requestGroupBindingConfirmation } =
      await import('../src/groupBinding.js');
    await requestGroupBindingConfirmation({
      chatId: -1003,
      telegramUserId: 9003,
      replyToMessageId: 79,
    });
    await handleGroupBindingCallback(callback({
      data: latestButtonData(1),
      userId: 9003,
      chatId: -1003,
      messageId: 503,
    }));
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(mocks.answerCallback).toHaveBeenCalledWith(
      'callback-1',
      'Bekor qilindi / Cancelled',
    );
  });
});
