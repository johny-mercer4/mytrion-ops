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
  /** Telegram serves this only when the user's profile photo is public. */
  photo_url?: string;
}

export interface TelegramHapticFeedback {
  impactOccurred: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void;
  notificationOccurred: (type: 'error' | 'success' | 'warning') => void;
}

export interface TelegramWebApp {
  initData: string;
  initDataUnsafe: { start_param?: string; user?: TelegramWebAppUser };
  ready: () => void;
  expand: () => void;
  colorScheme?: 'light' | 'dark';
  onEvent?: (event: string, handler: () => void) => void;
  HapticFeedback?: TelegramHapticFeedback;
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
 * Mirror Telegram's colorScheme onto <html data-theme>. Telegram's theme is NOT the OS theme — a
 * user can run Telegram dark on a light phone — so prefers-color-scheme alone would leave the
 * logo's ring black on a black surface. Re-applied on themeChanged, which Telegram fires when the
 * user switches theme with the app open.
 */
export function syncTelegramTheme(): void {
  const wa = getTelegramWebApp();
  if (!wa) return;
  const apply = (): void => {
    document.documentElement.dataset['theme'] = wa.colorScheme ?? 'light';
  };
  apply();
  wa.onEvent?.('themeChanged', apply);
}

/** Native-feeling touch response. No-op outside Telegram. */
export function haptic(kind: 'success' | 'error' | 'tap'): void {
  const h = getTelegramWebApp()?.HapticFeedback;
  if (!h) return;
  if (kind === 'tap') h.impactOccurred('light');
  else h.notificationOccurred(kind);
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
