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
  /** IETF tag, e.g. 'ru', 'en', 'uz' — the seed for the app's default language. */
  language_code?: string;
}

export interface TelegramHapticFeedback {
  impactOccurred: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void;
  notificationOccurred: (type: 'error' | 'success' | 'warning') => void;
}

/** Telegram's native header back arrow — shown/hidden by the app to mirror its own layered
 *  navigation (sheets, sub-screens). Present on every client that supports Mini Apps ≥6.1. */
export interface TelegramBackButton {
  show: () => void;
  hide: () => void;
  onClick: (handler: () => void) => void;
  offClick: (handler: () => void) => void;
}

export interface TelegramWebApp {
  initData: string;
  initDataUnsafe: { start_param?: string; user?: TelegramWebAppUser };
  ready: () => void;
  expand: () => void;
  colorScheme?: 'light' | 'dark';
  onEvent?: (event: string, handler: () => void) => void;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
  setBottomBarColor?: (color: string) => void;
  HapticFeedback?: TelegramHapticFeedback;
  BackButton?: TelegramBackButton;
}

declare global {
  interface Window {
    Telegram?: { WebApp: TelegramWebApp };
  }
}

export function getTelegramWebApp(): TelegramWebApp | null {
  return window.Telegram?.WebApp ?? null;
}

/** The app's own surfaces (see styles/global.css) — Telegram's chrome is painted to match. */
const HEADER_COLOR = '#ffffff';
const BACKGROUND_COLOR = '#f2f3f5';

/**
 * The app is light-only, so ask Telegram to paint ITS chrome light too. Without this, a user on
 * Telegram's dark theme gets a black header and bottom bar wrapped around a white app. Re-applied
 * on themeChanged, which Telegram fires (and which resets its chrome) when the user switches theme
 * with the app open.
 */
export function forceLightTheme(): void {
  const wa = getTelegramWebApp();
  if (!wa) return;
  const apply = (): void => {
    wa.setHeaderColor?.(HEADER_COLOR);
    wa.setBackgroundColor?.(BACKGROUND_COLOR);
    wa.setBottomBarColor?.(HEADER_COLOR);
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
  // 'go-*' params are ACTION deep-links for already-registered users (see getStartAction) —
  // never a registration id, so they must not leak into the invite-redeem path.
  if (startParam && !startParam.startsWith('go-')) return startParam;
  return new URLSearchParams(window.location.search).get('token');
}

/**
 * Action deep-link: `?startapp=go-<action>` opens a registered user's app ON that screen —
 * the support bot's "you can do this yourself" links. Unknown actions are ignored (the app
 * just opens home), so an old client build never breaks on a new link.
 */
export type StartAction = 'override' | 'moneycode' | 'funds' | 'txns' | 'pinunit' | 'status' | 'invoices';
const START_ACTIONS: readonly StartAction[] = ['override', 'moneycode', 'funds', 'txns', 'pinunit', 'status', 'invoices'];

export function getStartAction(): StartAction | null {
  const startParam = getTelegramWebApp()?.initDataUnsafe.start_param;
  if (!startParam?.startsWith('go-')) return null;
  const action = startParam.slice(3);
  return (START_ACTIONS as readonly string[]).includes(action) ? (action as StartAction) : null;
}
