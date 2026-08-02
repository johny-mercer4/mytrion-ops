/**
 * Telegram transport state only. Semantic intent belongs to aiRouter.ts.
 *
 * Static checks are intentionally limited to facts Telegram can verify: a bot mention,
 * a reply to the bot, or an already-active per-user conversation.
 */
import type { TgMessage } from './telegram.js';

export type EngagementReason = 'mention' | 'reply' | 'followup';
export type TelegramEngagementMode = 'direct' | 'all_registered';

const engagedAt = new Map<number, Map<number, number>>();
const FOLLOWUP_MS = 10 * 60_000;

export function noteEngaged(chatId: number, userId: number): void {
  let users = engagedAt.get(chatId);
  if (!users) engagedAt.set(chatId, (users = new Map()));
  users.set(userId, Date.now());
}

export function isConversationActive(chatId: number, userId: number): boolean {
  const engaged = engagedAt.get(chatId)?.get(userId);
  return engaged !== undefined && Date.now() - engaged <= FOLLOWUP_MS;
}

setInterval(() => {
  const cutoff = Date.now() - FOLLOWUP_MS;
  for (const [chatId, users] of engagedAt) {
    for (const [userId, engaged] of users) {
      if (engaged < cutoff) users.delete(userId);
    }
    if (!users.size) engagedAt.delete(chatId);
  }
}, FOLLOWUP_MS).unref();

export function engagementReason(
  message: TgMessage,
  botUsername: string,
): EngagementReason | null {
  const text = (message.text ?? message.caption ?? '').trim();
  if (
    botUsername &&
    text.toLocaleLowerCase().includes(`@${botUsername.toLocaleLowerCase()}`)
  ) {
    return 'mention';
  }
  if (
    botUsername &&
    message.reply_to_message?.from?.username?.toLocaleLowerCase() ===
      botUsername.toLocaleLowerCase()
  ) {
    return 'reply';
  }
  return isConversationActive(message.chat.id, message.from?.id ?? 0)
    ? 'followup'
    : null;
}

export function shouldEngage(
  message: TgMessage,
  botUsername: string,
): boolean {
  return engagementReason(message, botUsername) !== null;
}

/**
 * Production defaults to direct threads so ambient chatter across hundreds of groups cannot
 * consume model capacity. Once a verified mention/reply starts a thread, follow-ups remain natural.
 */
export function shouldRouteAtIngress(
  mode: TelegramEngagementMode,
  reason: EngagementReason | null,
): boolean {
  return mode === 'all_registered' || reason !== null;
}
