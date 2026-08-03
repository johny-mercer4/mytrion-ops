/**
 * Octane OpenAI gateway — Telegram long polling, per-chat history, and local function calling.
 * Long-poll loop: every inbound group message → note sender (tool guard) → enqueue a turn
 * on that chat's serial queue → reply with the session's final text (or stay silent).
 */
import { config } from './config.js';
import {
  enqueueTurn,
  flushSessions,
  maxConcurrentTurns,
  routingHistoryFor,
  waitForTurnDrain,
} from './sessions.js';
import {
  getUpdates,
  sendMessage,
  sendTyping,
  setReaction,
  clearReaction,
  type TgMessage,
} from './telegram.js';
import { buildOctaneTools, noteSender } from './tools.js';
import { buildTelegramTools, notePhoto } from './telegramTools.js';
import {
  engagementReason,
  isConversationActive,
  noteEngaged,
  shouldRouteAtIngress,
} from './filter.js';
import { flushTurnLog, startMonitor } from './monitor.js';
import { flushMessageLogs, logMessage } from './messageLog.js';
import { registeredRole } from './access.js';
import { carrierFor, chatMapSize } from './chatMap.js';
import { incrementCounter, startSamplers } from './metrics.js';
import { enabledServiceSummary } from './serviceRegistry.js';
import { processInOrderByKey } from './ingressOrder.js';
import { MessageBurstBuffer } from './messageBurst.js';
import { messageCollectionQuietMs } from './messageCollection.js';
import type { GatewayRole } from './skillRegistry.js';
import { classifySupportTurn } from './aiRouter.js';
import { requestAdmissionSnapshot, tryAdmitRequest } from './requestAdmission.js';
import { handleCallback } from './callbackHandler.js';
import { requestGroupBindingConfirmation } from './groupBinding.js';
import { logTurn, sendOverloadReply, stampElapsed } from './turnTelemetry.js';
import { startGatewayLeaderLease } from './leaderLease.js';

/**
 * One-time signpost for a TAGGED but unregistered user. Gate 2 used to be pure silence, which
 * reads as "the bot is broken" to exactly the person we want to funnel into mini-app
 * registration (live case: a new group member tagged the bot four times over two hours and got
 * nothing). Static string — zero LLM tokens — and at most once per user per 24h, so the
 * registered-only token rule stands.
 */
const REG_NUDGE_TTL_MS = 24 * 3600_000;
const REG_NUDGE_MAX_USERS = 100_000;
const regNudge = new Map<number, number>();
setInterval(() => {
  const cutoff = Date.now() - REG_NUDGE_TTL_MS;
  for (const [userId, nudgedAt] of regNudge) {
    if (nudgedAt < cutoff) regNudge.delete(userId);
  }
}, REG_NUDGE_TTL_MS).unref();
function regNudgeText(): string {
  const link = config.miniAppLink ? `\n${config.miniAppLink}` : '';
  return (
    "I can only help registered Octane mini-app users. Ask your company owner for an invite link, or if you're a driver, register in the mini-app with your fuel card number." +
    "\n\nMen faqat Octane mini-app'da ro'yxatdan o'tgan foydalanuvchilarga yordam bera olaman. Kompaniya egangizdan taklif havolasini so'rang; haydovchilar mini-app'da karta raqami bilan ro'yxatdan o'tadi." +
    link
  );
}

function noteRegistrationNudge(userId: number): void {
  if (!regNudge.has(userId) && regNudge.size >= REG_NUDGE_MAX_USERS) {
    const oldest = regNudge.keys().next().value as number | undefined;
    if (oldest !== undefined) regNudge.delete(oldest);
  }
  regNudge.delete(userId);
  regNudge.set(userId, Date.now());
}

const configuredIngressConcurrency = Number(
  process.env['TELEGRAM_INGRESS_CONCURRENCY'] ?? '32',
);
const INGRESS_CONCURRENCY =
  Number.isSafeInteger(configuredIngressConcurrency) &&
  configuredIngressConcurrency > 0 &&
  configuredIngressConcurrency <= 128
    ? configuredIngressConcurrency
    : 32;

interface BufferedMessage {
  message: TgMessage;
  updateId: number;
  carrierId: string;
  role: GatewayRole;
  receivedAt: number;
  direct: boolean;
  conversationActive: boolean;
}

const RECENT_CONTEXT_MS = 5 * 60_000;
const RECENT_CONTEXT_MAX = 12;
const recentContext = new Map<string, BufferedMessage[]>();

function rememberContext(key: string, item: BufferedMessage): void {
  const cutoff = Date.now() - RECENT_CONTEXT_MS;
  const items = [...(recentContext.get(key) ?? []), item]
    .filter((candidate) => candidate.receivedAt >= cutoff)
    .slice(-RECENT_CONTEXT_MAX);
  recentContext.set(key, items);
}

function contextFor(key: string): BufferedMessage[] {
  const cutoff = Date.now() - RECENT_CONTEXT_MS;
  const items = (recentContext.get(key) ?? []).filter(
    (candidate) => candidate.receivedAt >= cutoff,
  );
  if (items.length) recentContext.set(key, items);
  else recentContext.delete(key);
  return items;
}

function formatPrompt(messages: readonly TgMessage[]): string {
  const last = messages.at(-1);
  if (!last) throw new Error('cannot format an empty Telegram message burst');
  const name = last.from?.first_name ?? last.from?.username ?? 'user';
  const body = messages
    .map((message, index) => {
      const text = message.text ?? message.caption ?? '';
      const photoHint = message.photo
        ? ' [photo attached — call telegram_read_image if its contents matter]'
        : '';
      return `${index + 1}. ${text}${photoHint}`.trimEnd();
    })
    .join('\n');
  return `[msg ${last.message_id} from ${name} (id ${last.from?.id ?? 0})]: The user sent these messages in sequence. Treat them as one request:\n${body}`;
}

async function main(): Promise<void> {
  const leaderLease = await startGatewayLeaderLease();
  const admission = requestAdmissionSnapshot();
  console.log(
    `octane-agent-gateway-openai up · model=${config.openaiModel} · vision=${config.openaiModel} · engagement=${config.telegramEngagementMode} · leaderLease=${config.gatewayLeaseEnabled ? 'on' : 'off'} · maxConcurrent=${maxConcurrentTurns()} · maxPending=${admission.maxPending} · maxPendingPerUser=${admission.maxPendingPerUser} · maxPendingPerCarrier=${admission.maxPendingPerCarrier} · services=${enabledServiceSummary()} · mapped chats=${await chatMapSize()}${config.groupChatId ? ' + env fallback' : ''}`,
  );
  startSamplers();
  const monitor = startMonitor();
  const shutdownController = new AbortController();
  let stopping = false;
  const beginShutdown = (): void => {
    stopping = true;
    shutdownController.abort();
  };
  process.once('SIGTERM', beginShutdown);
  process.once('SIGINT', beginShutdown);
  const messageBursts = new MessageBurstBuffer<BufferedMessage>({
    quietMs: config.telegramBurstQuietMs,
    maxWaitMs: Math.max(config.telegramBurstQuietMs, config.telegramBurstMaxMs),
    quietMsFor: (items) =>
      messageCollectionQuietMs(
        items.map((item) => item.message.text ?? item.message.caption ?? ''),
        config.telegramBurstQuietMs,
      ),
    maxKeys: config.telegramBurstMaxKeys,
    maxItemsPerKey: config.telegramBurstMaxItemsPerKey,
    onOverflow: () => incrementCounter('message_burst_overflow_total'),
    onError: (error) => {
      console.error(
        '[messageBurst] flush failed',
        error instanceof Error ? error.message : String(error),
      );
    },
    onFlush: async (items) => {
      const first = items[0];
      const last = items.at(-1);
      if (!first || !last) return;
      const contextKey = `${last.message.chat.id}:${last.message.from?.id ?? 0}`;
      const contextItems = contextFor(contextKey);
      const messages = contextItems.map((item) => item.message);
      const currentMessages = items.map((item) => item.message);
      const message = last.message;
      const chatId = message.chat.id;
      const userId = message.from?.id ?? 0;
      const name = message.from?.first_name ?? message.from?.username ?? 'user';
      const question = currentMessages
        .map((item) => (item.text ?? item.caption ?? '') + (item.photo ? ' [photo]' : ''))
        .join('\n');
      const requestLease = tryAdmitRequest(String(userId), last.carrierId, first.receivedAt);
      if (!requestLease) {
        recentContext.delete(contextKey);
        await sendOverloadReply({
          kind: 'message',
          chatId,
          carrierId: last.carrierId,
          userId,
          name,
          question,
          receivedAt: first.receivedAt,
          replyToMessageId: message.message_id,
        });
        for (const item of currentMessages) {
          void clearReaction(chatId, item.message_id).catch(() => undefined);
        }
        return;
      }
      let handedToTurnQueue = false;
      try {
        const manifests = [
          ...buildOctaneTools(chatId, last.carrierId, userId, `tg:${last.updateId}`),
          ...buildTelegramTools(chatId, userId),
        ];
        const route = await classifySupportTurn({
          role: last.role,
          direct: items.some((item) => item.direct),
          conversationActive: items.some((item) => item.conversationActive),
          trustedConfirmation: false,
          currentText: question,
          context: [
            ...routingHistoryFor(chatId, userId),
            ...contextItems.map((item) => ({
              role: 'user' as const,
              content:
                (item.message.text ?? item.message.caption ?? '') +
                (item.message.photo ? ' [photo]' : ''),
            })),
          ],
          manifests,
          deadlineAt: requestLease.deadlineAt,
        });
        if (!route.engage) return;
        recentContext.delete(contextKey);
        if (route.source === 'overload-fallback') {
          await sendOverloadReply({
            kind: 'message',
            chatId,
            carrierId: last.carrierId,
            userId,
            name,
            question,
            receivedAt: first.receivedAt,
            replyToMessageId: message.message_id,
          });
          return;
        }
        if (config.messageLogMode === 'engaged') {
          for (const bufferedItem of items) {
            const item = bufferedItem.message;
            logMessage({
              ts: new Date(bufferedItem.receivedAt).toISOString(),
              carrierId: last.carrierId,
              chatId,
              msgId: item.message_id,
              userId,
              name,
              dir: 'in',
              text: item.text ?? item.caption ?? '',
              ...(item.photo ? { photo: true } : {}),
              engaged: true,
            });
          }
        }
        incrementCounter('ambient_engagement_total');
        const reply = { text: '' };
        const baseStats = logTurn(
          'message',
          chatId,
          userId,
          name,
          question,
          first.receivedAt,
          reply,
        );
        const stats: typeof baseStats = (turnStats) => {
          try {
            baseStats(turnStats);
            for (const item of currentMessages) {
              void clearReaction(chatId, item.message_id).catch(() => undefined);
            }
          } finally {
            requestLease.release();
          }
        };
        if (items.length > 1) {
          incrementCounter('message_burst_total');
          incrementCounter('message_burst_messages_total', items.length);
        }
        enqueueTurn(
          chatId,
          userId,
          last.carrierId,
          last.role,
          route,
          formatPrompt(messages),
          async (text) => {
            const finalText = stampElapsed(text, first.receivedAt);
            reply.text = finalText;
            await sendMessage(chatId, finalText, message.message_id);
            logMessage({
              ts: new Date().toISOString(),
              carrierId: last.carrierId,
              chatId,
              userId: 0,
              name: 'bot',
              dir: 'out',
              text: finalText,
            });
          },
          stats,
          {
            deadlineAt: requestLease.deadlineAt,
            receivedAt: first.receivedAt,
            turnId: `tg:${last.updateId}`,
          },
        );
        handedToTurnQueue = true;
      } finally {
        if (!handedToTurnQueue) {
          requestLease.release();
          for (const item of currentMessages) {
            void clearReaction(chatId, item.message_id).catch(() => undefined);
          }
        }
      }
    },
  });
  let offset = 0;
  while (!stopping) {
    if (!leaderLease.isLeader()) {
      await leaderLease.waitForLeadership(shutdownController.signal);
      if (stopping) break;
    }
    try {
      const updates = await getUpdates(
        offset,
        AbortSignal.any([shutdownController.signal, leaderLease.pollSignal]),
      );
      let processedAll = true;
      for (let start = 0; start < updates.length; start += INGRESS_CONCURRENCY) {
        if (!leaderLease.isLeader()) {
          processedAll = false;
          break;
        }
        const batch = updates.slice(start, start + INGRESS_CONCURRENCY);
        await processInOrderByKey(
          batch,
          (u) => {
            const cb = u.callback_query;
            if (cb?.message) return `${cb.message.chat.id}:${cb.from.id}`;
            const message = u.message;
            if (message) return `${message.chat.id}:${message.from?.id ?? 0}`;
            return `update:${u.update_id}`;
          },
          async (u) => {
            if (await handleCallback(u, (key) => messageBursts.flush(key))) return;
            const m = u.message;
            if (!m || m.from?.is_bot) return;
            if (!m.text && !m.caption && !m.photo) return;
            const engagement = engagementReason(m, config.botUsername);
            const direct = engagement === 'mention' || engagement === 'reply';
            let carrier = await carrierFor(m.chat.id);
            if (!carrier) {
              // Unmapped chat: a direct mention from an active owner/manager opens a server-resolved
              // company confirmation. The callback performs the DB write only after that same user
              // taps Yes. Ambient chatter, drivers and strangers remain invisible (zero tokens).
              const uid = m.from?.id ?? 0;
              const isGroup = m.chat.type === 'group' || m.chat.type === 'supergroup';
              if (uid !== 0 && isGroup && direct) {
                const prompted = await requestGroupBindingConfirmation({
                  chatId: m.chat.id,
                  telegramUserId: uid,
                  replyToMessageId: m.message_id,
                });
                if (prompted) return;
                carrier = await carrierFor(m.chat.id); // manual-map race while preview was running
              }
              if (!carrier) return;
            }
            // Telegram-verifiable routing runs before any model call. Production's `direct` mode
            // ignores ambient group chatter; `MESSAGE_LOG_MODE=all` remains an explicit opt-in.
            const conversationActive = isConversationActive(m.chat.id, m.from?.id ?? 0);
            const role = await registeredRole(carrier, m.from?.id ?? 0);
            const registered = role !== null;
            logMessage({
              ts: new Date().toISOString(),
              carrierId: carrier,
              chatId: m.chat.id,
              msgId: m.message_id,
              userId: m.from?.id ?? 0,
              name: m.from?.first_name ?? m.from?.username ?? 'user',
              dir: 'in',
              text: m.text ?? m.caption ?? '',
              ...(m.photo ? { photo: true } : {}),
            });
            // Photo cache runs BEFORE gate 1 (drivers post the photo first, tag next message) but
            // still only for REGISTERED users — an outsider's image never enters the cache. The
            // photo message itself costs zero LLM tokens either way.
            if (m.photo && registered) notePhoto(m.chat.id, m.from?.id ?? 0, m.photo);
            // Only registered users reach the AI router. Explicit outsiders get one signpost.
            if (!registered) {
              const uid = m.from?.id ?? 0;
              if (direct && uid !== 0 && Date.now() - (regNudge.get(uid) ?? 0) > REG_NUDGE_TTL_MS) {
                noteRegistrationNudge(uid);
                await sendMessage(m.chat.id, regNudgeText(), m.message_id).catch(() => undefined);
                logMessage({
                  ts: new Date().toISOString(),
                  carrierId: carrier,
                  chatId: m.chat.id,
                  userId: 0,
                  name: 'bot',
                  dir: 'out',
                  text: '[registration signpost]',
                });
              }
              return;
            }
            if (!shouldRouteAtIngress(config.telegramEngagementMode, engagement)) {
              incrementCounter('ingress_policy_dropped_total');
              return;
            }
            const contextKey = `${m.chat.id}:${m.from?.id ?? 0}`;
            const buffered = {
              message: m,
              updateId: u.update_id,
              carrierId: carrier,
              role,
              receivedAt: Date.now(),
              direct,
              conversationActive,
            };
            noteSender(m.chat.id, m.from?.id ?? 0);
            noteEngaged(m.chat.id, m.from?.id ?? 0);
            void setReaction(m.chat.id, m.message_id, '👀').catch(() => undefined);
            void sendTyping(m.chat.id);
            rememberContext(contextKey, buffered);
            if (!messageBursts.push(contextKey, buffered)) {
              recentContext.delete(contextKey);
              await clearReaction(m.chat.id, m.message_id).catch(() => undefined);
              await sendOverloadReply({
                kind: 'message',
                chatId: m.chat.id,
                carrierId: carrier,
                userId: m.from?.id ?? 0,
                name: m.from?.first_name ?? m.from?.username ?? 'user',
                question: m.text ?? m.caption ?? '[photo]',
                receivedAt: buffered.receivedAt,
                replyToMessageId: m.message_id,
              });
            }
          },
        );
      }
      const newest = updates.at(-1);
      if (newest && processedAll) offset = newest.update_id + 1;
    } catch (err) {
      if (stopping) break;
      if (!leaderLease.isLeader()) continue;
      console.error('poll error', err);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  await messageBursts.flushAll();
  await waitForTurnDrain(25_000);
  await leaderLease.stop();
  await Promise.all([flushSessions(), flushMessageLogs(), flushTurnLog()]);
  await new Promise<void>((resolve) => monitor.close(() => resolve()));
}

void main();
