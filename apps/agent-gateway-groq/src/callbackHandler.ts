import { registeredRole } from './access.js';
import { classifySupportTurn } from './aiRouter.js';
import { carrierFor } from './chatMap.js';
import { parseConfirmationCallback, resolveConfirmation } from './confirmations.js';
import { noteEngaged } from './filter.js';
import { logMessage } from './messageLog.js';
import { tryAdmitRequest } from './requestAdmission.js';
import { enqueueConfirmedTurn, enqueueTurn, routingHistoryFor } from './sessions.js';
import {
  answerCallback,
  clearButtons,
  sendMessage,
  sendTyping,
  type TgUpdate,
} from './telegram.js';
import { buildTelegramTools } from './telegramTools.js';
import { buildOctaneTools, noteSender } from './tools.js';
import { logTurn, sendOverloadReply, stampElapsed } from './turnTelemetry.js';

export async function handleCallback(
  update: TgUpdate,
  flushBurst: (key: string) => Promise<void>,
): Promise<boolean> {
  const callback = update.callback_query;
  if (!callback) return false;
  if (!callback.message) {
    await answerCallback(callback.id, 'This action is unavailable.', true);
    return true;
  }
  const chatId = callback.message.chat.id;
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
  const confirmation = parseConfirmationCallback(callback.data);
  if (!confirmation) void answerCallback(callback.id);
  noteSender(chatId, callback.from.id);
  noteEngaged(chatId, callback.from.id);
  void sendTyping(chatId);
  const name = callback.from.first_name ?? callback.from.username ?? 'user';
  const receivedAt = Date.now();
  const question = confirmation
    ? `[confirmation tap] ${confirmation.decision}`
    : `[tap] ${(callback.data ?? '').slice(0, 64)}`;
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

    if (confirmation) {
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
    }

    const prompt = `[button tap from ${name} (id ${callback.from.id})]: ${callback.data ?? ''}`;
    const manifests = [
      ...buildOctaneTools(chatId, carrierId, callback.from.id, `tg:${update.update_id}`),
      ...buildTelegramTools(chatId, callback.from.id),
    ];
    const route = await classifySupportTurn({
      role,
      direct: true,
      conversationActive: true,
      trustedConfirmation: false,
      currentText: callback.data ?? '',
      context: routingHistoryFor(chatId, callback.from.id),
      manifests,
      deadlineAt: lease.deadlineAt,
    });
    if (route.source === 'overload-fallback') {
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
    enqueueTurn(chatId, callback.from.id, carrierId, role, route, prompt, onReply, onStats, {
      deadlineAt: lease.deadlineAt,
      receivedAt,
      turnId: `tg:${update.update_id}`,
    });
    handedToTurnQueue = true;
    return true;
  } finally {
    if (!handedToTurnQueue) lease.release();
  }
}
