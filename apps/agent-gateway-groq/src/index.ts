/**
 * Octane OpenAI gateway — Telegram long polling, per-chat history, and local function calling.
 * Long-poll loop: every inbound group message → note sender (tool guard) → enqueue a turn
 * on that chat's serial queue → reply with the session's final text (or stay silent).
 */
import { config } from './config.js';
import {
  enqueueTurn,
  maxConcurrentTurns,
  routingHistoryFor,
} from './sessions.js';
import { getUpdates, sendMessage, sendTyping, setReaction, clearReaction, type TgMessage , answerCallback } from './telegram.js';
import { buildOctaneTools, noteSender } from './tools.js';
import { buildTelegramTools, notePhoto } from './telegramTools.js';
import {
  engagementReason,
  isConversationActive,
  noteEngaged,
} from './filter.js';
import { recordTurn, startMonitor } from './monitor.js';
import { logMessage } from './messageLog.js';
import { registeredRole } from './access.js';
import { carrierFor, chatMapSize, tryAutoBind } from './chatMap.js';
import { incrementCounter, startSamplers } from './metrics.js';
import { enabledServiceSummary } from './serviceRegistry.js';
import { processInOrderByKey } from './ingressOrder.js';
import { MessageBurstBuffer } from './messageBurst.js';
import type { GatewayRole } from './skillRegistry.js';
import { classifySupportTurn } from './aiRouter.js';

/**
 * One-time signpost for a TAGGED but unregistered user. Gate 2 used to be pure silence, which
 * reads as "the bot is broken" to exactly the person we want to funnel into mini-app
 * registration (live case: a new group member tagged the bot four times over two hours and got
 * nothing). Static string — zero LLM tokens — and at most once per user per 24h, so the
 * registered-only token rule stands.
 */
const REG_NUDGE_TTL_MS = 24 * 3600_000;
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

/**
 * Long-turn UX. The "still working" line is the MODEL's job now (telegram_progress tool —
 * contextual, in the user's own language, names the task), because a canned harness string is
 * not the reply a client wants. The harness keeps only the honest part it alone can know: a
 * final reply that took over REPORT_ELAPSED_OVER_MS carries its ⏱ duration.
 */
const REPORT_ELAPSED_OVER_MS = Number(process.env['REPORT_ELAPSED_OVER_MS'] ?? '120000');
const ingressConcurrency = Number(
  process.env['TELEGRAM_INGRESS_CONCURRENCY'] ?? '32',
);
const INGRESS_CONCURRENCY =
  Number.isSafeInteger(ingressConcurrency) && ingressConcurrency > 0
    ? ingressConcurrency
    : 32;

function fmtElapsed(ms: number): string {
  const m = Math.floor(ms / 60_000);
  const sec = Math.round((ms % 60_000) / 1000);
  return m > 0 ? `${m} min ${sec} s` : `${sec} s`;
}

/** Stamp a long turn's reply with how long it actually took. */
function stampElapsed(text: string, startedAt: number): string {
  const elapsed = Date.now() - startedAt;
  return elapsed > REPORT_ELAPSED_OVER_MS ? `${text}\n\n⏱ ${fmtElapsed(elapsed)}` : text;
}

/** One-time announcement when an owner's message auto-binds a fresh group. */
function bindAnnounceText(companyName: string | null): string {
  const co = companyName ? ` — ${companyName}` : '';
  return `✅ Guruh ulandi${co}. Endi shu yerda savol berishingiz mumkin: karta status, Money Code, hisobotlar. / Group connected${co}. Card status, Money Code, reports — just ask.`;
}

interface BufferedMessage {
  message: TgMessage;
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

/** Bridge a finished turn into the web monitor (question, wait, exec, tokens). */
function logTurn(
  kind: 'message' | 'button',
  chatId: number,
  userId: number,
  name: string,
  question: string,
  enqueuedAt: number,
  replyRef: { text: string },
) {
  return (stats: import('./sessions.js').TurnStats): void => {
    const un = (k: string): number => Number(stats.usage?.[k] ?? 0) || 0;
    recordTurn({
      ts: new Date(enqueuedAt).toISOString(),
      chatId,
      userId,
      name,
      kind,
      question: question.slice(0, 300),
      reply: stats.isError && stats.errMsg ? `⚠ ${stats.errMsg}`.slice(0, 300) : replyRef.text.slice(0, 300),
      waitMs:
        stats.queueWaitMs ??
        Math.max(0, Date.now() - enqueuedAt - stats.durationMs),
      execMs: stats.durationMs,
      ...(stats.totalMs !== undefined ? { totalMs: stats.totalMs } : {}),
      ...(stats.sendMs !== undefined ? { sendMs: stats.sendMs } : {}),
      numTurns: stats.numTurns,
      inTok: un('input_tokens'),
      outTok: un('output_tokens'),
      cacheRead: un('cache_read_input_tokens'),
      cacheWrite: un('cache_creation_input_tokens'),
      isError: stats.isError,
    });
  };
}

async function main(): Promise<void> {
  console.log(
    `octane-agent-gateway-openai up · model=${config.openaiModel} · vision=${config.openaiModel} · maxConcurrent=${maxConcurrentTurns()} · services=${enabledServiceSummary()} · mapped chats=${await chatMapSize()}${config.groupChatId ? ' + env fallback' : ''}`,
  );
  startSamplers();
  startMonitor();
  const messageBursts = new MessageBurstBuffer<BufferedMessage>({
    quietMs: config.telegramBurstQuietMs,
    maxWaitMs: Math.max(
      config.telegramBurstQuietMs,
      config.telegramBurstMaxMs,
    ),
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
        .map(
          (item) =>
            (item.text ?? item.caption ?? '') + (item.photo ? ' [photo]' : ''),
        )
        .join('\n');
      const manifests = [
        ...buildOctaneTools(chatId, last.carrierId, userId),
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
      });
      if (!route.engage) return;
      recentContext.delete(contextKey);
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
        baseStats(turnStats);
        for (const item of currentMessages) {
          void clearReaction(chatId, item.message_id).catch(() => undefined);
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
            chatId,
            userId: 0,
            name: 'bot',
            dir: 'out',
            text: finalText,
          });
        },
        stats,
      );
    },
  });
  let offset = 0;
  for (;;) {
    try {
      const updates = await getUpdates(offset);
      for (let start = 0; start < updates.length; start += INGRESS_CONCURRENCY) {
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
        // Button taps: ack instantly, gate by registration, then feed the tap into the session
        // as a structured line — the tapper's id comes from Telegram itself (sender-verified by
        // construction), so tools may act on it like any spoken message.
        const cb = u.callback_query;
        const cbCarrier = cb?.message ? await carrierFor(cb.message.chat.id) : null;
        if (cb?.message && cbCarrier) {
          await messageBursts.flush(`${cb.message.chat.id}:${cb.from.id}`);
          void answerCallback(cb.id);
          const cbRole = await registeredRole(cbCarrier, cb.from.id);
          if (!cbRole) return;
          const chatId = cb.message.chat.id;
          noteSender(chatId, cb.from.id);
          noteEngaged(chatId, cb.from.id);
          void sendTyping(chatId);
          const name = cb.from.first_name ?? cb.from.username ?? 'user';
          const cbReply = { text: '' };
          const cbAt = Date.now();
          logMessage({ ts: new Date().toISOString(), chatId, userId: cb.from.id, name, dir: 'in', text: `[tap] ${cb.data ?? ''}`, engaged: true });
          const cbStats = logTurn('button', chatId, cb.from.id, name, `[tap] ${cb.data ?? ''}`, cbAt, cbReply);
          const cbPrompt = `[button tap from ${name} (id ${cb.from.id})]: ${cb.data ?? ''}`;
          const cbManifests = [
            ...buildOctaneTools(chatId, cbCarrier, cb.from.id),
            ...buildTelegramTools(chatId, cb.from.id),
          ];
          const cbRoute = await classifySupportTurn({
            role: cbRole,
            direct: true,
            conversationActive: true,
            trustedConfirmation: cb.data?.split(':').at(-1) === 'yes',
            currentText: cb.data ?? '',
            context: routingHistoryFor(chatId, cb.from.id),
            manifests: cbManifests,
          });
          enqueueTurn(chatId, cb.from.id, cbCarrier, cbRole, cbRoute, cbPrompt, async (text) => {
            const finalText = stampElapsed(text, cbAt);
            cbReply.text = finalText;
            noteEngaged(chatId, cb.from.id);
            await sendMessage(chatId, finalText, cb.message?.message_id);
            logMessage({ ts: new Date().toISOString(), chatId, userId: 0, name: 'bot', dir: 'out', text: finalText });
          }, cbStats);
          return;
        }
        const m = u.message;
        if (!m || m.from?.is_bot) return;
        if (!m.text && !m.caption && !m.photo) return;
        let carrier = await carrierFor(m.chat.id);
        if (!carrier) {
          // Unmapped chat. AUTO-BIND: in a group, any message from a registered active owner
          // binds the chat to their carrier (server-verified) — announce once, then serve this
          // very message. Private chats and strangers' groups stay invisible (zero tokens).
          const uid = m.from?.id ?? 0;
          const isGroup = m.chat.type === 'group' || m.chat.type === 'supergroup';
          if (uid !== 0 && isGroup) {
            const boundNow = await tryAutoBind(m.chat.id, uid);
            if (boundNow) {
              carrier = boundNow.carrierId;
              await sendMessage(m.chat.id, bindAnnounceText(boundNow.companyName), m.message_id).catch(() => undefined);
              logMessage({ ts: new Date().toISOString(), chatId: m.chat.id, userId: 0, name: 'bot', dir: 'out', text: '[auto-bind announcement]' });
            } else {
              carrier = await carrierFor(m.chat.id); // already-bound race: map may have refreshed
            }
          }
          if (!carrier) return;
        }
        // Full history, PRE-gate — ordinary chatter is data too (the whole 54k-message analysis
        // came from exactly this kind of log). `engaged` is patched on below when a message
        // actually reaches the model.
        const engagement = engagementReason(m, config.botUsername);
        const direct = engagement === 'mention' || engagement === 'reply';
        const conversationActive = isConversationActive(
          m.chat.id,
          m.from?.id ?? 0,
        );
        const role = await registeredRole(carrier, m.from?.id ?? 0);
        const registered = role !== null;
        logMessage({
          ts: new Date().toISOString(),
          chatId: m.chat.id,
          msgId: m.message_id,
          userId: m.from?.id ?? 0,
          name: m.from?.first_name ?? m.from?.username ?? 'user',
          dir: 'in',
          text: m.text ?? m.caption ?? '',
          ...(m.photo ? { photo: true } : {}),
        });
        noteSender(m.chat.id, m.from?.id ?? 0);
        // Photo cache runs BEFORE gate 1 (drivers post the photo first, tag next message) but
        // still only for REGISTERED users — an outsider's image never enters the cache. The
        // photo message itself costs zero LLM tokens either way.
        if (m.photo && registered) notePhoto(m.chat.id, m.from?.id ?? 0, m.photo);
        // Only registered users reach the AI router. Explicit outsiders get one signpost.
        if (!registered) {
          const uid = m.from?.id ?? 0;
          if (direct && uid !== 0 && Date.now() - (regNudge.get(uid) ?? 0) > REG_NUDGE_TTL_MS) {
            regNudge.set(uid, Date.now());
            await sendMessage(m.chat.id, regNudgeText(), m.message_id).catch(() => undefined);
            logMessage({ ts: new Date().toISOString(), chatId: m.chat.id, userId: 0, name: 'bot', dir: 'out', text: '[registration signpost]' });
          }
          return;
        }
        const contextKey = `${m.chat.id}:${m.from?.id ?? 0}`;
        const buffered = {
          message: m,
          carrierId: carrier,
          role,
          receivedAt: Date.now(),
          direct,
          conversationActive,
        };
        noteEngaged(m.chat.id, m.from?.id ?? 0);
        void setReaction(m.chat.id, m.message_id, '👀').catch(() => undefined);
        void sendTyping(m.chat.id);
        rememberContext(contextKey, buffered);
        messageBursts.push(contextKey, buffered);
          },
        );
      }
      const newest = updates.at(-1);
      if (newest) offset = newest.update_id + 1;
    } catch (err) {
      console.error('poll error', err);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

void main();
