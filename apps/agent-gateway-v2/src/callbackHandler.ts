import { registeredRole } from './access.js';
import { carrierFor } from './chatMap.js';
import { parseConfirmationCallback, resolveConfirmation } from './confirmations.js';
import { noteEngaged } from './filter.js';
import { handleGroupBindingCallback } from './groupBinding.js';
import { logMessage } from './messageLog.js';
import { tryAdmitRequest } from './requestAdmission.js';
import { enqueueConfirmedTurn } from './sessions.js';
import {
  answerCallback,
  clearButtons,
  sendMessage,
  sendTyping,
  type TgUpdate,
} from './telegram.js';
import { noteSender } from './tools.js';
import { logTurn, sendOverloadReply, stampElapsed } from './turnTelemetry.js';

export async function handleCallback(
  update: TgUpdate,
  flushBurst: (key: string) => Promise<void>,
): Promise<boolean> {
  const callback = update.callback_query;
  if (!callback) return false;
  // Group-bind confirmation must run before carrierFor(): an unbound group intentionally has no
  // carrier until its requesting owner/manager taps Yes.
  if (await handleGroupBindingCallback(update)) return true;
  if (!callback.message) {
    await answerCallback(callback.id, 'This action is unavailable.', true);
    return true;
  }
  const chatId = callback.message.chat.id;
  const confirmation = parseConfirmationCallback(callback.data);
  if (!confirmation) {
    await clearButtons(chatId, callback.message.message_id);
    await answerCallback(callback.id, 'This button is no longer available.', true);
    return true;
  }
  const carrierId = await carrierFor(chatId);
  if (!carrierId) {
    await answerCallback(callback.id, 'This group is not connected to Octane.', true);
    return true;
  }
  await flushBurst(`${chatId}:${callback.from.id}`);
  const role = await registeredRole(carrierId, callback.from.id);
  if (!role) {
    await answerCallback(callback.id, 'Registration is required.', true);
    return true;
  }
  noteSender(chatId, callback.from.id);
  noteEngaged(chatId, callback.from.id);
  void sendTyping(chatId);
  const name = callback.from.first_name ?? callback.from.username ?? 'user';
  const receivedAt = Date.now();
  const question = `[confirmation tap] ${confirmation.decision}`;
  logMessage({
    ts: new Date(receivedAt).toISOString(),
    carrierId,
    chatId,
    userId: callback.from.id,
    name,
    dir: 'in',
    text: question,
    engaged: true,
  });
  const lease = tryAdmitRequest(String(callback.from.id), carrierId, receivedAt);
  if (!lease) {
    await answerCallback(callback.id, 'High demand — try again shortly.', true);
    await sendOverloadReply({
      kind: 'button',
      chatId,
      carrierId,
      userId: callback.from.id,
      name,
      question,
      receivedAt,
      replyToMessageId: callback.message.message_id,
    });
    return true;
  }

  let handedToTurnQueue = false;
  try {
    const reply = { text: '' };
    const baseStats = logTurn(
      'button',
      chatId,
      callback.from.id,
      name,
      question,
      receivedAt,
      reply,
    );
    const onStats = (stats: Parameters<typeof baseStats>[0]): void => {
      try {
        baseStats(stats);
      } finally {
        lease.release();
      }
    };
    const onReply = async (text: string): Promise<void> => {
      const finalText = stampElapsed(text, receivedAt);
      reply.text = finalText;
      await sendMessage(chatId, finalText, callback.message?.message_id);
      logMessage({
        ts: new Date().toISOString(),
        carrierId,
        chatId,
        userId: 0,
        name: 'bot',
        dir: 'out',
        text: finalText,
      });
    };

    let action;
    try {
      action = await resolveConfirmation({
        token: confirmation.token,
        carrierId,
        chatId,
        telegramUserId: callback.from.id,
        messageId: callback.message.message_id,
        updateId: update.update_id,
        decision: confirmation.decision,
      });
    } catch (error) {
      await answerCallback(
        callback.id,
        error instanceof Error ? error.message : 'Confirmation failed.',
        true,
      );
      return true;
    }
    await clearButtons(chatId, callback.message.message_id);
    if (!action) {
      await answerCallback(callback.id, 'Bekor qilindi / Cancelled');
      return true;
    }
    await answerCallback(callback.id, 'Tasdiq qabul qilindi / Confirmed');
    const prompt = `[button tap from ${name} (id ${callback.from.id})]: server-confirmed action`;
    await enqueueConfirmedTurn(
      chatId,
      callback.from.id,
      carrierId,
      role,
      action,
      prompt,
      onReply,
      onStats,
      { receivedAt },
    );
    handedToTurnQueue = true;
    return true;
  } finally {
    if (!handedToTurnQueue) lease.release();
  }
}
