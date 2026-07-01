/**
 * Telegram Bot API — thin native client. Auth is the bot token (TELEGRAM_BOT_TOKEN); the Bot API is
 * plain HTTPS, so there's no SDK. Every call POSTs JSON to
 *   https://api.telegram.org/bot<token>/<method>
 * and returns the `result`, throwing on { ok:false } or a network/HTTP error. Rate-limit errors
 * (429) surface the Bot API's `retry_after` in the thrown message so callers can back off.
 *
 * Exposed to the agent as native ToolManifest tools (see modules/tools/definitions/telegram.ts):
 * reads are read-risk; sends are write-risk (admin-gated by the dispatcher).
 */
import { env } from '../config/env.js';

const API_ROOT = 'https://api.telegram.org';

/** True when a bot token is configured. */
export function telegramConfigured(): boolean {
  return Boolean(env.TELEGRAM_BOT_TOKEN);
}

/** The configured default ("main") chat id, or '' if unset. */
export function defaultChatId(): string {
  return env.TELEGRAM_CHAT_ID_MAIN;
}

/**
 * Resolve the target chat for a send: an explicit value wins, else the configured main chat
 * (TELEGRAM_CHAT_ID_MAIN). Throws a clear error if neither is available, so a misconfigured deploy
 * fails loudly instead of silently sending nowhere.
 */
export function resolveChatId(explicit?: string): string {
  const id = (explicit ?? '').trim() || env.TELEGRAM_CHAT_ID_MAIN.trim();
  if (!id) {
    throw new Error('No Telegram chat target: pass `chatId`, or set TELEGRAM_CHAT_ID_MAIN.');
  }
  return id;
}

interface TelegramResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
  parameters?: { retry_after?: number; migrate_to_chat_id?: number };
}

/** Call a Bot API method. `undefined` params are dropped so optional fields don't serialize. */
export async function callTelegram<T = unknown>(
  method: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('Telegram is not configured (TELEGRAM_BOT_TOKEN is empty).');

  const body: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) if (v !== undefined) body[k] = v;

  let res: Response;
  try {
    res = await fetch(`${API_ROOT}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new Error(`[telegram] ${method}: network error — ${(e as Error)?.message ?? String(e)}`);
  }

  const text = await res.text();
  let json: TelegramResponse<T>;
  try {
    json = text ? (JSON.parse(text) as TelegramResponse<T>) : { ok: false, description: 'empty response' };
  } catch {
    throw new Error(`[telegram] ${method}: non-JSON response (HTTP ${res.status})`);
  }

  if (!json.ok) {
    const retry = json.parameters?.retry_after;
    const suffix = retry ? ` (retry_after=${retry}s)` : '';
    throw new Error(`[telegram] ${method} failed: ${json.description ?? `HTTP ${res.status}`}${suffix}`);
  }
  return json.result as T;
}

// --- Shapes of the bits of the Bot API responses the tools surface ---
export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
}

export interface TelegramMessage {
  message_id: number;
  date: number;
  chat: { id: number; type: string; title?: string; username?: string };
}
