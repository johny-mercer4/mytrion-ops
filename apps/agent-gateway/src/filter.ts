/**
 * The "caveman gate" — zero-token pre-filter, MENTION-ONLY mode (operator decision):
 * the bot engages ONLY when a REGISTERED user (checked separately in access.ts)
 *   1. @mentions the bot,
 *   2. replies to one of the bot's messages, or
 *   3. is inside the follow-up window (bot just engaged them — so "ha"/"yes" confirms
 *      work without re-tagging).
 * Everything else — service keywords included — never reaches Claude. Clients are taught
 * one habit: tag the bot when you want it.
 */
import type { TgMessage } from './telegram.js';

/** chatId → (userId → last time the BOT engaged with them, ms). Follow-up window. */
const engagedAt = new Map<number, Map<number, number>>();
const FOLLOWUP_MS = 3 * 60_000;

export function noteEngaged(chatId: number, userId: number): void {
  let m = engagedAt.get(chatId);
  if (!m) engagedAt.set(chatId, (m = new Map()));
  m.set(userId, Date.now());
}

export function shouldEngage(m: TgMessage, botUsername: string): boolean {
  const text = (m.text ?? m.caption ?? '').trim();
  if (botUsername && text.toLowerCase().includes(`@${botUsername.toLowerCase()}`)) return true;
  if (m.reply_to_message?.from?.username?.toLowerCase() === botUsername.toLowerCase()) return true;
  const ts = engagedAt.get(m.chat.id)?.get(m.from?.id ?? 0);
  if (ts != null && Date.now() - ts <= FOLLOWUP_MS) return true;
  return false;
}
