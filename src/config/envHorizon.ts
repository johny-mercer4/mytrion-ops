import { z } from 'zod';

/**
 * Mytrion Horizon (worker CRM) Telegram bot — a SEPARATE identity from the carrier client
 * mini-app / support bot.
 *
 *   HORIZON_BOT_TOKEN  → Bot API + WebApp initData HMAC (Telegram's documented algorithm).
 *   HORIZON_BOT_SECRET → setWebhook `secret_token` (header X-Telegram-Bot-Api-Secret-Token).
 *                        Telegram forbids `:` here, so this CANNOT be the bot token.
 *
 * Never point these at TELEGRAM_BOT_TOKEN / TELEGRAM_CARRIER_BOT_TOKEN. One poller/webhook
 * per token: the client bot stays on agent-gateway getUpdates; Horizon is webhook-only on
 * this API (or Menu Button with no inbound updates).
 */
export const horizonTelegramEnvShape = {
  HORIZON_BOT_TOKEN: z.string().default(''),
  HORIZON_BOT_SECRET: z.string().default(''),
  /** BotFather username without @. Used for t.me deep links. */
  HORIZON_BOT_USERNAME: z.string().default(''),
  /**
   * Public HTTPS URL Telegram should open for the worker CRM Mini App (typically
   * `https://<ops-host>/main`). Empty → derive `${RENDER_EXTERNAL_URL}/main` on Render.
   */
  HORIZON_MINI_APP_URL: z.string().default(''),
  /** BotFather named Mini App short name → https://t.me/<bot>/<shortname>. */
  HORIZON_MINI_APP_SHORT_NAME: z.string().default(''),
  /**
   * '1' when BotFather Main App is configured. Deep links then use
   * https://t.me/<bot>?startapp= (no short name).
   */
  HORIZON_MINI_APP_DIRECT: z.string().default(''),
  /**
   * Public HTTPS webhook this API exposes: `https://<ops-host>/v1/telegram/horizon-webhook`.
   * Empty → derive from RENDER_EXTERNAL_URL. Empty on both → skip setWebhook (Menu Button still works).
   */
  HORIZON_WEBHOOK_URL: z.string().default(''),
};
