/**
 * Mytrion Horizon worker-CRM Telegram bot — a separate token/identity from the carrier
 * client mini-app (`telegramCarrierBot.ts` / `TELEGRAM_CARRIER_BOT_TOKEN`) and from the
 * assistant toolkit (`telegram.ts` / `TELEGRAM_BOT_TOKEN`).
 *
 * Responsibilities:
 *   1. Reply to `/start` with an inline button that opens the worker CRM Mini App.
 *   2. Verify Telegram WebApp `initData` with HORIZON_BOT_TOKEN (HMAC-SHA256 / WebAppData).
 *   3. Register a webhook authenticated by HORIZON_BOT_SECRET (setWebhook secret_token).
 *
 * This module never long-polls. The client bot's agent-gateway getUpdates loop is untouched.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { env, isProduction, isTest } from '../config/env.js';
import { logger } from '../lib/logger.js';

const API_ROOT = 'https://api.telegram.org';
const WEBHOOK_PATH = '/v1/telegram/horizon-webhook';
const TELEGRAM_SECRET_HEADER = 'x-telegram-bot-api-secret-token';

export { TELEGRAM_SECRET_HEADER, WEBHOOK_PATH };

export function horizonBotConfigured(): boolean {
  return Boolean(env.HORIZON_BOT_TOKEN);
}

/** True when Horizon's token is accidentally the client/support bot token. */
export function horizonBotSharesClientToken(): boolean {
  const horizon = env.HORIZON_BOT_TOKEN;
  if (!horizon) return false;
  return (
    (Boolean(env.TELEGRAM_CARRIER_BOT_TOKEN) && horizon === env.TELEGRAM_CARRIER_BOT_TOKEN) ||
    (Boolean(env.TELEGRAM_BOT_TOKEN) && horizon === env.TELEGRAM_BOT_TOKEN)
  );
}

export function horizonBotUsername(): string {
  return env.HORIZON_BOT_USERNAME.trim().replace(/^@/, '');
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

/** Prefer an explicit HTTPS URL; otherwise `${renderOrigin}${suffix}` (Render injects RENDER_EXTERNAL_URL). */
export function derivePublicHttpsUrl(explicit: string, renderExternalUrl: string, suffix: string): string {
  const trimmed = explicit.trim();
  if (trimmed) return trimSlash(trimmed);
  const render = renderExternalUrl.trim();
  if (render) return `${trimSlash(render)}${suffix}`;
  return '';
}

/** Public Mini App URL for BotFather / web_app buttons. SPA launcher lives at `/main`. */
export function resolveHorizonMiniAppUrl(): string {
  return derivePublicHttpsUrl(env.HORIZON_MINI_APP_URL, process.env.RENDER_EXTERNAL_URL ?? '', '/main');
}

export function resolveHorizonWebhookUrl(): string {
  return derivePublicHttpsUrl(env.HORIZON_WEBHOOK_URL, process.env.RENDER_EXTERNAL_URL ?? '', WEBHOOK_PATH);
}

/** t.me link that opens the Horizon Mini App (Menu Button / named Mini App / startapp). */
export function buildHorizonOpenUrl(): string {
  const bot = horizonBotUsername();
  if (!bot) return resolveHorizonMiniAppUrl();
  if (env.HORIZON_MINI_APP_SHORT_NAME) {
    return `https://t.me/${bot}/${env.HORIZON_MINI_APP_SHORT_NAME}`;
  }
  if (env.HORIZON_MINI_APP_DIRECT === '1') {
    return `https://t.me/${bot}?startapp`;
  }
  return resolveHorizonMiniAppUrl();
}

async function callHorizonBot<T = unknown>(
  method: string,
  params: Record<string, unknown>,
): Promise<T> {
  const token = env.HORIZON_BOT_TOKEN;
  if (!token) throw new Error('Horizon bot is not configured (HORIZON_BOT_TOKEN is empty).');
  const res = await fetch(`${API_ROOT}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const json = (await res.json()) as { ok: boolean; result?: T; description?: string };
  if (!json.ok) {
    throw new Error(`[telegram-horizon-bot] ${method} failed: ${json.description ?? res.status}`);
  }
  return json.result as T;
}

export async function sendHorizonOpenPrompt(chatId: number | string): Promise<void> {
  const miniAppUrl = resolveHorizonMiniAppUrl();
  if (!miniAppUrl) {
    await callHorizonBot('sendMessage', {
      chat_id: chatId,
      text: 'Welcome to Mytrion Horizon. The worker app is not live at a public HTTPS URL yet — check back soon.',
    });
    return;
  }
  await callHorizonBot('sendMessage', {
    chat_id: chatId,
    text: 'Welcome to Mytrion Horizon. Tap below to open the worker CRM, then sign in with Zoho.',
    reply_markup: {
      inline_keyboard: [[{ text: 'Open Mytrion Horizon', web_app: { url: miniAppUrl } }]],
    },
  });
}

export function isHorizonStartCommand(text: string | undefined): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  const bot = horizonBotUsername();
  const names = bot ? [`/start@${bot}`, `/app@${bot}`] : [];
  return (
    trimmed === '/start' ||
    trimmed.startsWith('/start ') ||
    trimmed === '/app' ||
    names.includes(trimmed)
  );
}

/**
 * Verify Telegram's webhook secret_token header against HORIZON_BOT_SECRET.
 * Constant-time; unequal lengths fail closed without throwing.
 */
export function verifyHorizonWebhookSecret(header: string | string[] | undefined): boolean {
  const secret = env.HORIZON_BOT_SECRET;
  if (!secret) return false;
  if (typeof header !== 'string' || header.length === 0) return false;
  const expected = Buffer.from(secret);
  const actual = Buffer.from(header);
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

function hmacWebAppData(botToken: string, dataCheckString: string): string {
  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  return createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
}

/**
 * Verify a Telegram WebApp `initData` string with HORIZON_BOT_TOKEN (not HORIZON_BOT_SECRET).
 * Telegram HMAC-keys initData with the bot token; the separate secret is webhook-only.
 */
export function verifyHorizonInitData(
  initData: string,
  maxAgeSeconds = 3600,
): { ok: true; fields: Record<string, string> } | { ok: false } {
  const token = env.HORIZON_BOT_TOKEN;
  if (!token) return { ok: false };
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return { ok: false };
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const computedHash = hmacWebAppData(token, dataCheckString);
  const expected = Buffer.from(computedHash, 'hex');
  const actual = Buffer.from(hash, 'hex');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return { ok: false };

  const authDate = Number(params.get('auth_date'));
  if (!Number.isFinite(authDate) || Date.now() / 1000 - authDate > maxAgeSeconds) return { ok: false };

  const fields: Record<string, string> = {};
  for (const [k, v] of params.entries()) fields[k] = v;
  return { ok: true, fields };
}

export interface HorizonInitDataIdentity {
  telegramUserId: string;
  telegramChatId: string;
  telegramUsername: string | null;
}

function parseJsonObject(raw: string | undefined): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function numericId(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(Math.trunc(value));
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) return value.trim();
  return null;
}

/**
 * Telegram user (+ private chat) from already-verified initData fields.
 * When `chat` is absent (Menu Button / private Mini App), chat_id equals user id.
 */
export function parseHorizonInitDataIdentity(
  fields: Record<string, string>,
): HorizonInitDataIdentity | null {
  const user = parseJsonObject(fields.user);
  const telegramUserId = numericId(user?.id);
  if (!telegramUserId) return null;
  const chat = parseJsonObject(fields.chat);
  const telegramChatId = numericId(chat?.id) ?? telegramUserId;
  const usernameRaw = user?.username;
  const telegramUsername =
    typeof usernameRaw === 'string' && usernameRaw.trim() ? usernameRaw.trim() : null;
  return { telegramUserId, telegramChatId, telegramUsername };
}

/** Test helper: sign fields the same way Telegram would, using HORIZON_BOT_TOKEN. */
export function signHorizonInitData(fields: Record<string, string>): string {
  const token = env.HORIZON_BOT_TOKEN;
  if (!token) throw new Error('Horizon bot is not configured (HORIZON_BOT_TOKEN is empty).');
  const params = new URLSearchParams(fields);
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  params.set('hash', hmacWebAppData(token, dataCheckString));
  return params.toString();
}

/**
 * Register Telegram's webhook for the Horizon token only. No-op when token/secret/URL are
 * missing, in tests, or when the Horizon token collides with the client bot. Fail-open: a
 * Telegram outage must not take the API down; Menu Button still works without a webhook.
 */
export async function ensureHorizonWebhook(): Promise<void> {
  if (isTest) return;
  if (!env.HORIZON_BOT_TOKEN) return;
  if (horizonBotSharesClientToken()) {
    const msg =
      'HORIZON_BOT_TOKEN equals TELEGRAM_BOT_TOKEN or TELEGRAM_CARRIER_BOT_TOKEN — refusing to setWebhook so the client mini-app poller is not stolen.';
    if (isProduction) throw new Error(msg);
    logger.warn(msg);
    return;
  }
  if (!env.HORIZON_BOT_SECRET) {
    logger.warn(
      'Horizon bot token is set but HORIZON_BOT_SECRET is empty — skip setWebhook (Menu Button still works).',
    );
    return;
  }
  const url = resolveHorizonWebhookUrl();
  if (!url.startsWith('https://')) {
    logger.info('Horizon webhook URL is not public HTTPS — skip setWebhook');
    return;
  }
  try {
    await callHorizonBot('setWebhook', {
      url,
      secret_token: env.HORIZON_BOT_SECRET,
      allowed_updates: ['message'],
      drop_pending_updates: false,
    });
    logger.info({ url }, 'Horizon Telegram webhook registered');
  } catch (err) {
    logger.error({ err }, 'Horizon setWebhook failed (API continues; Menu Button still works)');
  }
}
