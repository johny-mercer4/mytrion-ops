import { z } from 'zod';
import { callTelegram, type TelegramMessage, type TelegramUser } from '../../../integrations/telegram.js';
import type { ToolManifest } from '../types.js';

/**
 * Native Telegram Bot API tools. Reads (get_me / get_updates / get_chat) are read-risk; sends
 * (message / photo / document) are write-risk → the dispatcher requires the admin role. Auth is the
 * bot token (server-side); callers never pass credentials.
 */

const chatId = z.string().min(1).describe('Target chat: numeric id (as a string) or @username of a channel/supergroup.');
const parseMode = z.enum(['Markdown', 'MarkdownV2', 'HTML']).optional();
const sentSchema = z.object({ messageId: z.number(), chatId: z.number(), date: z.number() });

function sent(m: TelegramMessage): z.infer<typeof sentSchema> {
  return { messageId: m.message_id, chatId: m.chat.id, date: m.date };
}

// ── send message (write) ───────────────────────────────────────────────────
const sendMessageInput = z.object({
  chatId,
  text: z.string().min(1).max(4096),
  parseMode,
  disableNotification: z.boolean().optional(),
  disableWebPagePreview: z.boolean().optional(),
  replyToMessageId: z.number().int().optional(),
});

export const telegramSendMessageTool: ToolManifest<z.infer<typeof sendMessageInput>, z.infer<typeof sentSchema>> = {
  name: 'telegram.send_message',
  description:
    'Send a text message to a Telegram chat via the bot. `chatId` is a numeric id (string) or @channelusername. Optional `parseMode` (Markdown/MarkdownV2/HTML) — omit it if text has unescaped special characters. Max 4096 chars.',
  inputSchema: sendMessageInput,
  outputSchema: sentSchema,
  riskClass: 'write',
  allowedAudiences: ['internal'],
  requiredScopes: ['telegram:write'],
  rateLimit: { perMinute: 20 },
  async handler(input) {
    const m = await callTelegram<TelegramMessage>('sendMessage', {
      chat_id: input.chatId,
      text: input.text,
      parse_mode: input.parseMode,
      disable_notification: input.disableNotification,
      disable_web_page_preview: input.disableWebPagePreview,
      reply_to_message_id: input.replyToMessageId,
    });
    return sent(m);
  },
};

// ── send photo (write) ─────────────────────────────────────────────────────
const sendPhotoInput = z.object({
  chatId,
  photo: z.string().min(1).describe('Public HTTPS URL or a Telegram file_id.'),
  caption: z.string().max(1024).optional(),
  parseMode,
  disableNotification: z.boolean().optional(),
});

export const telegramSendPhotoTool: ToolManifest<z.infer<typeof sendPhotoInput>, z.infer<typeof sentSchema>> = {
  name: 'telegram.send_photo',
  description:
    'Send a photo to a Telegram chat. `photo` is a publicly reachable HTTPS URL or a Telegram file_id (base64/inline bytes are not accepted). Optional caption (≤1024 chars).',
  inputSchema: sendPhotoInput,
  outputSchema: sentSchema,
  riskClass: 'write',
  allowedAudiences: ['internal'],
  requiredScopes: ['telegram:write'],
  rateLimit: { perMinute: 20 },
  async handler(input) {
    const m = await callTelegram<TelegramMessage>('sendPhoto', {
      chat_id: input.chatId,
      photo: input.photo,
      caption: input.caption,
      parse_mode: input.parseMode,
      disable_notification: input.disableNotification,
    });
    return sent(m);
  },
};

// ── send document (write) ──────────────────────────────────────────────────
const sendDocumentInput = z.object({
  chatId,
  document: z.string().min(1).describe('Public HTTPS URL or a Telegram file_id.'),
  caption: z.string().max(1024).optional(),
  parseMode,
  disableNotification: z.boolean().optional(),
});

export const telegramSendDocumentTool: ToolManifest<z.infer<typeof sendDocumentInput>, z.infer<typeof sentSchema>> = {
  name: 'telegram.send_document',
  description:
    'Send a document/file to a Telegram chat (preserves original format, unlike a photo). `document` is a publicly reachable HTTPS URL or a Telegram file_id. Optional caption (≤1024 chars).',
  inputSchema: sendDocumentInput,
  outputSchema: sentSchema,
  riskClass: 'write',
  allowedAudiences: ['internal'],
  requiredScopes: ['telegram:write'],
  rateLimit: { perMinute: 20 },
  async handler(input) {
    const m = await callTelegram<TelegramMessage>('sendDocument', {
      chat_id: input.chatId,
      document: input.document,
      caption: input.caption,
      parse_mode: input.parseMode,
      disable_notification: input.disableNotification,
    });
    return sent(m);
  },
};

// ── get me (read) ──────────────────────────────────────────────────────────
const getMeInput = z.object({});
const getMeOutput = z.object({ id: z.number(), isBot: z.boolean(), firstName: z.string(), username: z.string().optional() });

export const telegramGetMeTool: ToolManifest<z.infer<typeof getMeInput>, z.infer<typeof getMeOutput>> = {
  name: 'telegram.get_me',
  description: 'Get the bot’s own identity (id, username, first_name). Use to verify the bot token is valid.',
  inputSchema: getMeInput,
  outputSchema: getMeOutput,
  riskClass: 'read',
  allowedAudiences: ['internal'],
  requiredScopes: ['telegram:read'],
  rateLimit: { perMinute: 60 },
  async handler() {
    const u = await callTelegram<TelegramUser>('getMe');
    const out: z.infer<typeof getMeOutput> = { id: u.id, isBot: u.is_bot, firstName: u.first_name };
    if (u.username !== undefined) out.username = u.username;
    return out;
  },
};

// ── get updates (read) ─────────────────────────────────────────────────────
const getUpdatesInput = z.object({
  offset: z.number().int().optional().describe('First update id to return (highest received + 1) to ack prior ones.'),
  limit: z.number().int().min(1).max(100).optional(),
  timeout: z.number().int().min(0).max(50).optional().describe('Long-poll seconds; keep small here.'),
});
const getUpdatesOutput = z.object({ count: z.number(), updates: z.array(z.record(z.unknown())) });

export const telegramGetUpdatesTool: ToolManifest<z.infer<typeof getUpdatesInput>, z.infer<typeof getUpdatesOutput>> = {
  name: 'telegram.get_updates',
  description:
    'Fetch incoming updates via long polling (getUpdates). Fails if a webhook is set. Advance `offset` past the highest update_id to avoid re-reading. Returns raw Update objects.',
  inputSchema: getUpdatesInput,
  outputSchema: getUpdatesOutput,
  riskClass: 'read',
  allowedAudiences: ['internal'],
  requiredScopes: ['telegram:read'],
  rateLimit: { perMinute: 60 },
  async handler(input) {
    const updates = await callTelegram<Record<string, unknown>[]>('getUpdates', {
      offset: input.offset,
      limit: input.limit,
      timeout: input.timeout,
    });
    const list = Array.isArray(updates) ? updates : [];
    return { count: list.length, updates: list };
  },
};

// ── get chat (read) ────────────────────────────────────────────────────────
const getChatInput = z.object({ chatId });
const getChatOutput = z.object({ chat: z.record(z.unknown()) });

export const telegramGetChatTool: ToolManifest<z.infer<typeof getChatInput>, z.infer<typeof getChatOutput>> = {
  name: 'telegram.get_chat',
  description:
    'Get up-to-date info about a chat (title, type, username, etc.). `chatId` is a numeric id (string) or @channelusername. The bot must be a member of / have access to the chat.',
  inputSchema: getChatInput,
  outputSchema: getChatOutput,
  riskClass: 'read',
  allowedAudiences: ['internal'],
  requiredScopes: ['telegram:read'],
  rateLimit: { perMinute: 60 },
  async handler(input) {
    const chat = await callTelegram<Record<string, unknown>>('getChat', { chat_id: input.chatId });
    return { chat: chat ?? {} };
  },
};

/** The native Telegram toolkit, registered flag-gated (FF_TELEGRAM_ENABLED) in the tool catalog. */
export const telegramTools = [
  telegramSendMessageTool,
  telegramSendPhotoTool,
  telegramSendDocumentTool,
  telegramGetMeTool,
  telegramGetUpdatesTool,
  telegramGetChatTool,
] as const;
