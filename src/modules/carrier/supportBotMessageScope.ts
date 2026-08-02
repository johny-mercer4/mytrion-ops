import { AppError } from '../../lib/errors.js';

interface MessageScope {
  chatId: string;
  carrierId: string;
}

interface ChatScope extends MessageScope {
  enabled: boolean;
}

/** Reject mixed-carrier, disabled, and unknown chat log rows before insert. */
export function assertSupportBotMessageScope(
  messages: readonly MessageScope[],
  chats: readonly ChatScope[],
): void {
  const byChat = new Map(chats.map((chat) => [chat.chatId, chat]));
  for (const message of messages) {
    const chat = byChat.get(message.chatId);
    if (!chat?.enabled || chat.carrierId !== message.carrierId) {
      throw new AppError('Message carrier does not match the enabled Telegram chat mapping', {
        statusCode: 403,
        code: 'SUPPORT_BOT_MESSAGE_SCOPE_MISMATCH',
        expose: true,
      });
    }
  }
}
