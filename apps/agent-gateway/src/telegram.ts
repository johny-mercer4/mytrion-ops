/** Raw Telegram Bot API over fetch — no SDK dependency for an MVP this small. */
import { config } from './config.js';
import { incrementCounter } from './metrics.js';

const API = `https://api.telegram.org/bot${config.botToken}`;

/**
 * GLOBAL send throttle. Per-user parallelism can fire many replies/reactions/typing pulses at once;
 * Telegram's Bot API has its OWN limit (~30 msg/s globally) and 429s — sustained 429s get the bot
 * temporarily banned. So all OUTBOUND sends are spaced ≥ TELEGRAM_MIN_GAP_MS apart. Two lanes share
 * one clock:
 *   - queued(): ordered, must-deliver (replies, buttons, reactions, callback acks). Never dropped.
 *   - bestEffort(): typing pulses — skipped if a send happened within the gap, so cosmetic keep-alives
 *     never delay a real reply (a dropped typing tick is invisible; it re-fires in ~4s anyway).
 * Polling (getUpdates) and file downloads are NOT throttled — they are reads on separate limits.
 */
const SEND_MIN_GAP_MS = Number(process.env['TELEGRAM_MIN_GAP_MS'] ?? '40'); // ≈25 sends/s
// Every outbound POST is time-bounded. Without this, one hung Telegram connection would stall the
// SERIALIZED send chain forever — freezing every user's reply. The timeout lets the chain advance.
const SEND_TIMEOUT_MS = Number(process.env['TELEGRAM_SEND_TIMEOUT_MS'] ?? '10000');
let sendChain: Promise<unknown> = Promise.resolve();
let lastSendAt = 0;
/** Bot-API 429 backoff: no outbound send before this ms-epoch (set from Telegram's retry_after). */
let blockedUntil = 0;

/** One outbound Bot-API POST, always time-bounded. */
function tgPost(method: string, payload: Record<string, unknown>): Promise<Response> {
  return fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  });
}

/**
 * tgPost + Bot-API error handling for the must-deliver lane. On 429, honor Telegram's authoritative
 * `retry_after` (stamp `blockedUntil` so the whole queue backs off, not just this send) and retry
 * ONCE after the wait — sustained blind re-sending is what gets bots banned. Any other non-ok
 * response is logged (a silently dropped reply is a user staring at nothing) but not retried.
 */
async function tgSend(method: string, payload: Record<string, unknown>): Promise<Response> {
  try {
    let res = await tgPost(method, payload);
    if (res.status === 429) {
      incrementCounter('tg_429_total');
      const body = (await res.json().catch(() => null)) as {
        parameters?: { retry_after?: number };
      } | null;
      const waitMs =
        Math.max(1, body?.parameters?.retry_after ?? 1) * 1000;
      blockedUntil = Date.now() + waitMs;
      console.warn(
        `[tg] 429 on ${method} — backing off ${waitMs}ms (retry_after)`,
      );
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      lastSendAt = Date.now();
      res = await tgPost(method, payload);
      if (res.status === 429) incrementCounter('tg_429_total');
    }
    if (!res.ok) {
      incrementCounter('tg_send_fail_total');
      const errText = await res.text().catch(() => '');
      console.error(
        `[tg] ${method} failed ${res.status}: ${errText.slice(0, 200)}`,
      );
    }
    return res;
  } catch (error) {
    incrementCounter('tg_send_fail_total');
    throw error;
  }
}

function queued<T>(fn: () => Promise<T>): Promise<T> {
  const run = sendChain.then(async () => {
    const wait = Math.max(lastSendAt + SEND_MIN_GAP_MS, blockedUntil) - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastSendAt = Date.now();
    return fn();
  });
  // Keep the chain alive regardless of any single send's outcome (a rejection must not stall the queue).
  sendChain = run.then(() => undefined, () => undefined);
  return run;
}

function bestEffort(fn: () => Promise<void>): Promise<void> {
  const now = Date.now();
  if (now - lastSendAt < SEND_MIN_GAP_MS || now < blockedUntil) return Promise.resolve(); // yield to real sends + backoff
  lastSendAt = now;
  return fn().catch(() => undefined);
}

export interface TgMessage {
  message_id: number;
  chat: { id: number; type: string; title?: string };
  from?: { id: number; first_name?: string; username?: string; is_bot?: boolean };
  text?: string;
  caption?: string;
  photo?: Array<{ file_id: string; width: number; height: number; file_size?: number }>;
  reply_to_message?: { message_id: number; from?: { username?: string; is_bot?: boolean } };
}

export interface TgCallbackQuery {
  id: string;
  from: { id: number; first_name?: string; username?: string };
  message?: { message_id: number; chat: { id: number; type?: string } };
  data?: string;
}

export async function getUpdates(offset: number): Promise<Array<{ update_id: number; message?: TgMessage; callback_query?: TgCallbackQuery }>> {
  try {
    const res = await fetch(`${API}/getUpdates?timeout=50&offset=${offset}&allowed_updates=%5B%22message%22%2C%22callback_query%22%5D`, {
      signal: AbortSignal.timeout(60_000),
    });
    if (res.status === 429) incrementCounter('tg_429_total');
    const body = (await res.json()) as { ok: boolean; result?: Array<{ update_id: number; message?: TgMessage; callback_query?: TgCallbackQuery }> };
    if (!res.ok || !body.ok) incrementCounter('tg_poll_fail_total');
    return body.ok ? (body.result ?? []) : [];
  } catch (error) {
    incrementCounter('tg_poll_fail_total');
    throw error;
  }
}

export async function sendMessage(chatId: number, text: string, replyTo?: number): Promise<void> {
  await queued(() =>
    tgSend('sendMessage', {
      chat_id: chatId,
      text,
      ...(replyTo ? { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } } : {}),
    }),
  );
}

/** Download a Telegram file as base64 (photos: pick with pickPhotoSize first). ≤10MB guard. */
export async function getFileBase64(fileId: string): Promise<{ data: string; mediaType: string } | null> {
  const meta = await fetch(`${API}/getFile?file_id=${encodeURIComponent(fileId)}`, { signal: AbortSignal.timeout(20_000) });
  const body = (await meta.json()) as { ok: boolean; result?: { file_path?: string; file_size?: number } };
  const path = body.result?.file_path;
  if (!body.ok || !path || (body.result?.file_size ?? 0) > 10_000_000) return null;
  const res = await fetch(`https://api.telegram.org/file/bot${config.botToken}/${path}`, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  const ext = path.split('.').pop()?.toLowerCase() ?? 'jpg';
  const mediaType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
  return { data: buf.toString('base64'), mediaType };
}

/** Token-frugal size choice: the largest variant ≤1280px — card digits stay readable, tokens stay sane. */
export function pickPhotoSize(photos: Array<{ file_id: string; width: number }>): string | null {
  if (!photos.length) return null;
  const fit = [...photos].filter((p) => p.width <= 1280).sort((a, b) => b.width - a.width)[0];
  return (fit ?? photos[photos.length - 1])!.file_id;
}

/** Emoji reaction — the cheapest possible ack (the human agents' "done ✅" habit). */
export async function setReaction(chatId: number, messageId: number, emoji: string): Promise<void> {
  await queued(() => tgSend('setMessageReaction', { chat_id: chatId, message_id: messageId, reaction: [{ type: 'emoji', emoji }] }));
}

/** Remove any reaction the bot put on a message — an empty reaction array clears it. */
export async function clearReaction(chatId: number, messageId: number): Promise<void> {
  await queued(() => tgSend('setMessageReaction', { chat_id: chatId, message_id: messageId, reaction: [] }));
}

/** Message with tappable inline buttons — the group bot's real "UI". Buttons arrive back as
 *  callback_query taps (routed into the session as [button tap ...] lines). ≤8 buttons, 2/row. */
/** Returns the sent message_id (for button-ownership tracking), or null if the send failed. */
export async function sendButtons(
  chatId: number,
  text: string,
  buttons: Array<{ label: string; data: string }>,
  replyTo?: number,
): Promise<number | null> {
  const rows: Array<Array<{ text: string; callback_data: string }>> = [];
  for (const b of buttons.slice(0, 8)) {
    const btn = { text: b.label.slice(0, 40), callback_data: b.data.slice(0, 64) };
    const last = rows[rows.length - 1];
    if (last && last.length < 2) last.push(btn);
    else rows.push([btn]);
  }
  const res = await queued(() =>
    tgSend('sendMessage', {
      chat_id: chatId,
      text,
      reply_markup: { inline_keyboard: rows },
      ...(replyTo ? { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } } : {}),
    }),
  );
  const body = (await res.json().catch(() => null)) as { ok?: boolean; result?: { message_id?: number } } | null;
  return body?.ok && body.result?.message_id != null ? body.result.message_id : null;
}

/** Ack a button tap. Optional text is shown as an alert for an unavailable/expired action. */
export async function answerCallback(callbackId: string, text?: string): Promise<void> {
  await queued(() =>
    tgSend('answerCallbackQuery', {
      callback_query_id: callbackId,
      ...(text ? { text: text.slice(0, 200), show_alert: true } : {}),
    }),
  ).catch(() => {});
}

export async function sendTyping(chatId: number): Promise<void> {
  // Cosmetic keep-alive — best-effort so it never queues ahead of (or delays) a real reply.
  await bestEffort(() => tgPost('sendChatAction', { chat_id: chatId, action: 'typing' }).then(() => undefined));
}

const TYPING_REFRESH_MS = 4000;

/** Keep Telegram's expiring typing action alive until the caller settles the turn. */
export function startTypingKeepAlive(chatId: number): () => void {
  void sendTyping(chatId).catch(() => undefined);
  const timer = setInterval(
    () => void sendTyping(chatId).catch(() => undefined),
    TYPING_REFRESH_MS,
  );
  return () => clearInterval(timer);
}

/** A downloaded image, ready to hand to the model as a base64 content block. */
export interface TgImage {
  data: string;
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp';
}

interface TgPhotoSize {
  file_id: string;
  width: number;
  height: number;
}

/**
 * Download the LARGEST size of a Telegram photo as base64 (Telegram sends an
 * ascending array of sizes; the last is the highest-resolution). Two calls:
 * getFile → the file_path, then the file-download host. Returns null on any hiccup
 * so a photo the bot can't fetch degrades to "describe it / send last-6" instead of
 * crashing the turn.
 */
export async function fetchPhotoBase64(photo: unknown[]): Promise<TgImage | null> {
  const sizes = photo as TgPhotoSize[];
  const largest = sizes.at(-1);
  if (!largest?.file_id) return null;
  try {
    const meta = await fetch(`${API}/getFile?file_id=${encodeURIComponent(largest.file_id)}`, {
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await meta.json()) as { ok: boolean; result?: { file_path?: string } };
    const path = body.result?.file_path;
    if (!body.ok || !path) return null;
    const bin = await fetch(`https://api.telegram.org/file/bot${config.botToken}/${path}`, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!bin.ok) return null;
    const data = Buffer.from(await bin.arrayBuffer()).toString('base64');
    const mediaType = path.endsWith('.png') ? 'image/png' : path.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
    return { data, mediaType };
  } catch {
    return null;
  }
}
