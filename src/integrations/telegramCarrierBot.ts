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
