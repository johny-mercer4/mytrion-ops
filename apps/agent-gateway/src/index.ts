/**
 * Octane agent gateway (v2 MVP) — one group, per-chat Claude sessions over the Agent SDK.
 * Long-poll loop: every inbound group message → note sender (tool guard) → enqueue a turn
 * on that chat's serial queue → reply with the session's final text (or stay silent).
 */
import { config } from './config.js';
import { enqueueTurn } from './sessions.js';
import { getUpdates, sendMessage, sendTyping, type TgMessage , answerCallback } from './telegram.js';
import { noteSender } from './tools.js';
import { notePhoto } from './telegramTools.js';
import { noteEngaged, shouldEngage } from './filter.js';
import { recordTurn, startMonitor } from './monitor.js';
import { logMessage } from './messageLog.js';
import { isRegistered } from './access.js';
import { carrierFor, chatMapSize, tryAutoBind } from './chatMap.js';

/**
 * One-time signpost for a TAGGED but unregistered user. Gate 2 used to be pure silence, which
 * reads as "the bot is broken" to exactly the person we want to funnel into mini-app
 * registration (live case: a new group member tagged the bot four times over two hours and got
 * nothing). Static string — zero LLM tokens — and at most once per user per 24h, so the
 * registered-only token rule stands.
 */
const REG_NUDGE_TTL_MS = 24 * 3600_000;
const regNudge = new Map<number, number>();
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

function formatPrompt(m: TgMessage): string {
  const name = m.from?.first_name ?? m.from?.username ?? 'user';
  const body = m.text ?? m.caption ?? '';
  const photoHint = m.photo ? '\n[the user attached a photo — call telegram_read_image to read it if its contents matter]' : '';
  return `[msg ${m.message_id} from ${name} (id ${m.from?.id ?? 0})]: ${body}${photoHint}`;
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
      waitMs: Math.max(0, Date.now() - enqueuedAt - stats.durationMs),
      execMs: stats.durationMs,
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
  console.log(`octane-agent-gateway up · model=${config.model} · mapped chats=${await chatMapSize()}${config.groupChatId ? ' + env fallback' : ''}`);
  startMonitor();
  let offset = 0;
  for (;;) {
    try {
      const updates = await getUpdates(offset);
      for (const u of updates) {
        offset = u.update_id + 1;
        // Button taps: ack instantly, gate by registration, then feed the tap into the session
        // as a structured line — the tapper's id comes from Telegram itself (sender-verified by
        // construction), so tools may act on it like any spoken message.
        const cb = u.callback_query;
        const cbCarrier = cb?.message ? await carrierFor(cb.message.chat.id) : null;
        if (cb?.message && cbCarrier) {
          void answerCallback(cb.id);
          if (!(await isRegistered(cbCarrier, cb.from.id))) continue;
          const chatId = cb.message.chat.id;
          noteSender(chatId, cb.from.id);
          noteEngaged(chatId, cb.from.id);
          void sendTyping(chatId);
          const name = cb.from.first_name ?? cb.from.username ?? 'user';
          const cbReply = { text: '' };
          const cbAt = Date.now();
          logMessage({ ts: new Date().toISOString(), chatId, userId: cb.from.id, name, dir: 'in', text: `[tap] ${cb.data ?? ''}`, engaged: true });
          const cbStats = logTurn('button', chatId, cb.from.id, name, `[tap] ${cb.data ?? ''}`, cbAt, cbReply);
          enqueueTurn(chatId, cbCarrier, `[button tap from ${name} (id ${cb.from.id})]: ${cb.data ?? ''}`, async (text) => {
            const finalText = stampElapsed(text, cbAt);
            cbReply.text = finalText;
            noteEngaged(chatId, cb.from.id);
            await sendMessage(chatId, finalText, cb.message?.message_id);
            logMessage({ ts: new Date().toISOString(), chatId, userId: 0, name: 'bot', dir: 'out', text: finalText });
          }, cbStats);
          continue;
        }
        const m = u.message;
        if (!m || m.from?.is_bot) continue;
        if (!m.text && !m.caption && !m.photo) continue;
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
          if (!carrier) continue;
        }
        // Full history, PRE-gate — ordinary chatter is data too (the whole 54k-message analysis
        // came from exactly this kind of log). `engaged` is patched on below when a message
        // actually reaches the model.
        const willEngage = shouldEngage(m, config.botUsername) && (await isRegistered(carrier, m.from?.id ?? 0));
        logMessage({
          ts: new Date().toISOString(),
          chatId: m.chat.id,
          msgId: m.message_id,
          userId: m.from?.id ?? 0,
          name: m.from?.first_name ?? m.from?.username ?? 'user',
          dir: 'in',
          text: m.text ?? m.caption ?? '',
          ...(m.photo ? { photo: true } : {}),
          ...(willEngage ? { engaged: true } : {}),
        });
        noteSender(m.chat.id, m.from?.id ?? 0);
        // Photo cache runs BEFORE gate 1 (drivers post the photo first, tag next message) but
        // still only for REGISTERED users — an outsider's image never enters the cache. The
        // photo message itself costs zero LLM tokens either way.
        if (m.photo && (await isRegistered(carrier, m.from?.id ?? 0))) notePhoto(m.chat.id, m.from?.id ?? 0, m.photo);
        // Caveman gate 1: only @mentions / replies-to-bot / follow-ups reach further.
        if (!shouldEngage(m, config.botUsername)) continue;
        // Caveman gate 2: only REGISTERED mini-app users get any tokens at all. A tagged
        // unregistered user gets the static registration signpost instead of silence.
        if (!(await isRegistered(carrier, m.from?.id ?? 0))) {
          const uid = m.from?.id ?? 0;
          if (uid !== 0 && Date.now() - (regNudge.get(uid) ?? 0) > REG_NUDGE_TTL_MS) {
            regNudge.set(uid, Date.now());
            await sendMessage(m.chat.id, regNudgeText(), m.message_id).catch(() => undefined);
            logMessage({ ts: new Date().toISOString(), chatId: m.chat.id, userId: 0, name: 'bot', dir: 'out', text: '[registration signpost]' });
          }
          continue;
        }
        void sendTyping(m.chat.id);
        const mName = m.from?.first_name ?? m.from?.username ?? 'user';
        const mQuestion = (m.text ?? m.caption ?? '') + (m.photo ? ' [photo]' : '');
        const mReply = { text: '' };
        const mAt = Date.now();
        const mStats = logTurn('message', m.chat.id, m.from?.id ?? 0, mName, mQuestion, mAt, mReply);
        enqueueTurn(m.chat.id, carrier, formatPrompt(m), async (text) => {
          const finalText = stampElapsed(text, mAt);
          mReply.text = finalText;
          noteEngaged(m.chat.id, m.from?.id ?? 0);
          await sendMessage(m.chat.id, finalText, m.message_id);
          logMessage({ ts: new Date().toISOString(), chatId: m.chat.id, userId: 0, name: 'bot', dir: 'out', text: finalText });
        }, mStats);
      }
    } catch (err) {
      console.error('poll error', err);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

void main();
