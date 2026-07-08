/**
 * Thin wrapper over the raw `window.Telegram.WebApp` global (loaded via the script tag in
 * index.html — see that file for why it's deliberately unpinned). `initData` is the opaque,
 * signed string the backend HMAC-verifies; `initDataUnsafe` is client-readable but untrusted.
 */
export interface TelegramWebAppUser {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
}

export interface TelegramWebApp {
  initData: string;
  initDataUnsafe: { start_param?: string; user?: TelegramWebAppUser };
  ready: () => void;
  expand: () => void;
  colorScheme?: 'light' | 'dark';
}

declare global {
  interface Window {
    Telegram?: { WebApp: TelegramWebApp };
  }
}

export function getTelegramWebApp(): TelegramWebApp | null {
  return window.Telegram?.WebApp ?? null;
}

/**
 * The registration link's id: `start_param` when opened via a direct `?startapp=` mini-app link,
 * else the `?token=` query param the bot's inline button uses (the `?start=` fallback path — see
 * sendInviteOpenPrompt). Returns null outside Telegram entirely (e.g. a bare browser preview).
 */
export function getRegistrationId(): string | null {
  const startParam = getTelegramWebApp()?.initDataUnsafe.start_param;
  if (startParam) return startParam;
  return new URLSearchParams(window.location.search).get('token');
}
