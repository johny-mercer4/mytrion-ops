/**
 * The carrier onboarding bot (@octane_support_ai_bot) — separate token/identity from the
 * assistant's own Telegram integration (integrations/telegram.ts). Two responsibilities:
 *   1. Reply to `/start <inviteId>` with an inline "Open" button that launches the mini-app.
 *   2. Verify a Telegram WebApp `initData` payload the mini-app forwards on registration —
 *      this is the actual security boundary (proves WHO the Telegram user is), per Telegram's
 *      documented HMAC-SHA256 verification algorithm.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';

const API_ROOT = 'https://api.telegram.org';

export function carrierBotConfigured(): boolean {
  return Boolean(env.TELEGRAM_CARRIER_BOT_TOKEN && env.TELEGRAM_CARRIER_BOT_USERNAME);
}

/** POST a Bot API method with the carrier bot's own token. Throws on { ok:false }. */
async function callCarrierBot<T = unknown>(
  method: string,
  params: Record<string, unknown>,
): Promise<T> {
  const token = env.TELEGRAM_CARRIER_BOT_TOKEN;
  if (!token) throw new Error('Carrier bot is not configured (TELEGRAM_CARRIER_BOT_TOKEN is empty).');
  const res = await fetch(`${API_ROOT}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const json = (await res.json()) as { ok: boolean; result?: T; description?: string };
  if (!json.ok) throw new Error(`[telegram-carrier-bot] ${method} failed: ${json.description ?? res.status}`);
  return json.result as T;
}

/** Reply to /start with an inline button that opens the mini-app, the invite id in its URL. */
export async function sendInviteOpenPrompt(opts: {
  chatId: number | string;
  companyName: string | null;
  inviteId: string;
}): Promise<void> {
  const miniAppUrl = env.TELEGRAM_CARRIER_MINI_APP_URL;
  const label = opts.companyName ? ` for ${opts.companyName}` : '';
  if (!miniAppUrl) {
    // Mini-app not deployed yet — degrade to a plain text reply instead of a dead button.
    await callCarrierBot('sendMessage', {
      chat_id: opts.chatId,
      text: `Welcome${label}! Your Octane onboarding link is ready, but the app isn't live yet — check back soon.`,
    });
    return;
  }
  const url = `${miniAppUrl}${miniAppUrl.includes('?') ? '&' : '?'}token=${encodeURIComponent(opts.inviteId)}`;
  await callCarrierBot('sendMessage', {
    chat_id: opts.chatId,
    text: `Welcome${label}! Tap below to finish setting up your Octane account.`,
    reply_markup: {
      inline_keyboard: [[{ text: 'Open Octane', web_app: { url } }]],
    },
  });
}

export async function sendPlainReply(chatId: number | string, text: string): Promise<void> {
  await callCarrierBot('sendMessage', { chat_id: chatId, text });
}

/** Thrown when Telegram refuses the send because the user has never opened a chat with the bot.
 *  A bot cannot message first — the user must tap Start, so this is the caller's cue to say so. */
export class TelegramChatUnreachableError extends Error {
  constructor(description: string) {
    super(description);
    this.name = 'TelegramChatUnreachableError';
  }
}

/** Telegram's own wording for "this user hasn't started me / has blocked me". Matching on the text
 *  is unfortunate but the Bot API returns 403 for several distinct cases and no machine code. */
function isChatUnreachable(description: string): boolean {
  return /bot can't initiate conversation|bot was blocked|user is deactivated|chat not found/i.test(description);
}

/**
 * Upload a file to a chat as a Telegram document.
 *
 * Separate from `callCarrierBot` because sendDocument needs multipart/form-data — a JSON body only
 * works for re-sending an already-uploaded file_id, not for new bytes.
 */
/** Escape the five characters Telegram's HTML parse mode treats as markup. A company name is data —
 *  an unescaped `&` or `<` in one would make Telegram reject the whole send with a parse error. */
export function escapeTelegramHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export async function sendDocument(opts: {
  chatId: number | string;
  fileName: string;
  contentType: string;
  bytes: Uint8Array | string;
  caption?: string;
  /** Set 'HTML' when the caption carries markup — it must already be escaped (see above). */
  parseMode?: 'HTML' | 'MarkdownV2';
}): Promise<void> {
  const token = env.TELEGRAM_CARRIER_BOT_TOKEN;
  if (!token) throw new Error('Carrier bot is not configured (TELEGRAM_CARRIER_BOT_TOKEN is empty).');

  const form = new FormData();
  form.append('chat_id', String(opts.chatId));
  if (opts.caption) form.append('caption', opts.caption);
  if (opts.parseMode) form.append('parse_mode', opts.parseMode);
  const body = typeof opts.bytes === 'string' ? new TextEncoder().encode(opts.bytes) : opts.bytes;
  // Copy into a fresh ArrayBuffer-backed view: a Uint8Array over a SharedArrayBuffer (or a pooled
  // Node Buffer) is not accepted by the Blob constructor's type contract.
  form.append('document', new Blob([new Uint8Array(body)], { type: opts.contentType }), opts.fileName);

  const res = await fetch(`${API_ROOT}/bot${token}/sendDocument`, { method: 'POST', body: form });
  const json = (await res.json()) as { ok: boolean; description?: string };
  if (!json.ok) {
    const description = json.description ?? String(res.status);
    if (isChatUnreachable(description)) throw new TelegramChatUnreachableError(description);
    throw new Error(`[telegram-carrier-bot] sendDocument failed: ${description}`);
  }
}

/**
 * Verify a Telegram WebApp `initData` string per Telegram's documented algorithm: HMAC-SHA256
 * of the sorted "key=value\n"-joined fields (minus `hash`), keyed by HMAC-SHA256("WebAppData",
 * bot_token). Returns the parsed fields only when the hash matches AND the payload is fresh —
 * this is what proves the request actually came from Telegram for this specific user, not a
 * forged (or replayed) POST body.
 *
 * `maxAgeSeconds` bounds replay: a signed initData blob is a bearer credential, so a captured one
 * (browser history, proxy log, shared device) must not stay valid forever. Onboarding is prompt,
 * so 1h is generous; tighten if needed.
 */
export function verifyTelegramInitData(
  initData: string,
  maxAgeSeconds = 3600,
): { ok: true; fields: Record<string, string> } | { ok: false } {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return { ok: false };
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const secretKey = createHmac('sha256', 'WebAppData').update(env.TELEGRAM_CARRIER_BOT_TOKEN).digest();
  const computedHash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  // Constant-time compare — a plain `!==` on the hex leaks, byte-by-byte via timing, how much of a
  // forged hash is correct. Unequal lengths (malformed hash) fail before timingSafeEqual, which
  // throws on a length mismatch.
  const expected = Buffer.from(computedHash, 'hex');
  const actual = Buffer.from(hash, 'hex');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return { ok: false };

  // Freshness: reject a valid-but-stale (or auth_date-less) signature.
  const authDate = Number(params.get('auth_date'));
  if (!Number.isFinite(authDate) || Date.now() / 1000 - authDate > maxAgeSeconds) return { ok: false };

  const fields: Record<string, string> = {};
  for (const [k, v] of params.entries()) fields[k] = v;
  return { ok: true, fields };
}

/**
 * The inverse of verifyTelegramInitData: sign a set of fields into a valid Telegram WebApp
 * `initData` string, using the SAME secret-derivation as the verifier above. Exists so a signer
 * (the dev-only mock-init-data route) never re-implements the HMAC algorithm independently and
 * drifts from what the verifier actually checks. NOT for production identity issuance — Telegram
 * itself is the only legitimate signer of a real user's initData; this is for locally testing the
 * verify path with a fake user.
 */
export function signTelegramInitData(fields: Record<string, string>): string {
  const params = new URLSearchParams(fields);
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secretKey = createHmac('sha256', 'WebAppData').update(env.TELEGRAM_CARRIER_BOT_TOKEN).digest();
  const hash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  params.set('hash', hash);
  return params.toString();
}

export interface TelegramWebAppUser {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
}

/** Parse the JSON-encoded `user` field out of already-verified initData fields. */
export function parseInitDataUser(fields: Record<string, string>): TelegramWebAppUser | null {
  const raw = fields.user;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && 'id' in parsed) return parsed as TelegramWebAppUser;
    return null;
  } catch {
    return null;
  }
}
