/** Raw Telegram Bot API over fetch — no SDK dependency for an MVP this small. */
import { config } from './config.js';

const API = `https://api.telegram.org/bot${config.botToken}`;

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
  message?: { message_id: number; chat: { id: number } };
  data?: string;
}

export async function getUpdates(offset: number): Promise<Array<{ update_id: number; message?: TgMessage; callback_query?: TgCallbackQuery }>> {
  const res = await fetch(`${API}/getUpdates?timeout=50&offset=${offset}&allowed_updates=%5B%22message%22%2C%22callback_query%22%5D`, {
    signal: AbortSignal.timeout(60_000),
  });
  const body = (await res.json()) as { ok: boolean; result?: Array<{ update_id: number; message?: TgMessage; callback_query?: TgCallbackQuery }> };
  return body.ok ? (body.result ?? []) : [];
}

export async function sendMessage(chatId: number, text: string, replyTo?: number): Promise<void> {
  await fetch(`${API}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      ...(replyTo ? { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } } : {}),
    }),
  });
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
  await fetch(`${API}/setMessageReaction`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, message_id: messageId, reaction: [{ type: 'emoji', emoji }] }),
  });
}

/** Message with tappable inline buttons — the group bot's real "UI". Buttons arrive back as
 *  callback_query taps (routed into the session as [button tap ...] lines). ≤8 buttons, 2/row. */
export async function sendButtons(
  chatId: number,
  text: string,
  buttons: Array<{ label: string; data: string }>,
  replyTo?: number,
): Promise<void> {
  const rows: Array<Array<{ text: string; callback_data: string }>> = [];
  for (const b of buttons.slice(0, 8)) {
    const btn = { text: b.label.slice(0, 40), callback_data: b.data.slice(0, 64) };
    const last = rows[rows.length - 1];
    if (last && last.length < 2) last.push(btn);
    else rows.push([btn]);
  }
  await fetch(`${API}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      reply_markup: { inline_keyboard: rows },
      ...(replyTo ? { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } } : {}),
    }),
  });
}

/** Ack a button tap so Telegram stops the spinner on the client. */
export async function answerCallback(callbackId: string): Promise<void> {
  await fetch(`${API}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackId }),
  }).catch(() => {});
}

export async function sendTyping(chatId: number): Promise<void> {
  await fetch(`${API}/sendChatAction`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, action: 'typing' }),
  }).catch(() => {});
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
