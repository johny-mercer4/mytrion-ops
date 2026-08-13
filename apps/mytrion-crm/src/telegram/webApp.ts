/**
 * Worker CRM Telegram Mini App host.
 *
 * This is NOT the carrier product in apps/mini-app. We load Telegram's WebApp SDK so the CRM can
 * run inside a worker Mini App: expand to the usable viewport, publish safe-area insets into the
 * existing layout tokens, and paint Telegram chrome to match the incumbent theme.
 *
 * Identity stays Zoho OAuth. initData is detected only so we know we are inside Telegram — it is
 * never treated as a login.
 */

export interface TelegramSafeArea {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface TelegramWebApp {
  initData: string;
  platform?: string;
  colorScheme?: 'light' | 'dark';
  ready: () => void;
  expand: () => void;
  disableVerticalSwipes?: () => void;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
  setBottomBarColor?: (color: string) => void;
  onEvent?: (event: string, handler: () => void) => void;
  offEvent?: (event: string, handler: () => void) => void;
  safeAreaInset?: TelegramSafeArea;
  contentSafeAreaInset?: TelegramSafeArea;
  viewportStableHeight?: number;
}

declare global {
  interface Window {
    Telegram?: { WebApp: TelegramWebApp };
    TelegramWebviewProxy?: unknown;
  }
}

const ZERO: TelegramSafeArea = { top: 0, bottom: 0, left: 0, right: 0 };

export function getTelegramWebApp(): TelegramWebApp | null {
  return window.Telegram?.WebApp ?? null;
}

/**
 * True inside Telegram's WebView / Mini App. The SDK script creates `window.Telegram.WebApp`
 * even in a normal browser, with empty initData and platform "unknown" — those must not count.
 */
export function isTelegramWebView(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.TelegramWebviewProxy) return true;
  const wa = window.Telegram?.WebApp;
  if (!wa) return false;
  if (wa.initData.length > 0) return true;
  if (wa.platform && wa.platform !== 'unknown') return true;
  return /Telegram/i.test(navigator.userAgent);
}

function insetPx(n: number | undefined): number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

function sumInset(
  safe: TelegramSafeArea | undefined,
  content: TelegramSafeArea | undefined,
  edge: keyof TelegramSafeArea,
): number {
  return insetPx(safe?.[edge]) + insetPx(content?.[edge]);
}

/** Publish Telegram + content safe-area as `--tg-inset-*` for the layout tokens to max() against. */
export function applyTelegramInsets(wa: TelegramWebApp | null = getTelegramWebApp()): void {
  const root = document.documentElement;
  const inside = Boolean(wa) && isTelegramWebView();
  const safe = inside ? (wa?.safeAreaInset ?? ZERO) : ZERO;
  const content = inside ? (wa?.contentSafeAreaInset ?? ZERO) : ZERO;
  root.style.setProperty('--tg-inset-top', `${sumInset(safe, content, 'top')}px`);
  root.style.setProperty('--tg-inset-bottom', `${sumInset(safe, content, 'bottom')}px`);
  root.style.setProperty('--tg-inset-left', `${sumInset(safe, content, 'left')}px`);
  root.style.setProperty('--tg-inset-right', `${sumInset(safe, content, 'right')}px`);
  const stable = inside ? wa?.viewportStableHeight : undefined;
  if (typeof stable === 'number' && stable > 0) {
    root.style.setProperty('--tg-viewport-stable-height', `${Math.round(stable)}px`);
  }
}

/**
 * Paint Telegram's own header / background / bottom bar to match CRM, not the other way around.
 * Mapping Telegram themeParams onto --accent would fork the design system per client theme.
 */
export function applyTelegramChrome(wa: TelegramWebApp | null = getTelegramWebApp()): void {
  if (!wa || !isTelegramWebView()) return;
  const theme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
  const page = theme === 'light' ? '#e0e4f0' : '#0a0e1a';
  try {
    wa.setHeaderColor?.(page);
    wa.setBackgroundColor?.(page);
    wa.setBottomBarColor?.(page);
  } catch {
    /* older clients omit the setters */
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', page);
}

const VIEWPORT_EVENTS = ['viewportChanged', 'safeAreaChanged', 'contentSafeAreaChanged', 'themeChanged'] as const;

/**
 * Call once at boot (and from the index.html inline script for first paint). Safe to call again.
 * No-ops outside Telegram so a normal mobile browser is unchanged.
 */
export function bootTelegram(): void {
  const wa = getTelegramWebApp();
  const root = document.documentElement;
  const inside = isTelegramWebView();

  if (inside) {
    root.dataset.telegram = 'true';
    try {
      wa?.ready();
    } catch {
      /* ignore */
    }
    try {
      wa?.expand();
    } catch {
      /* ignore */
    }
    try {
      wa?.disableVerticalSwipes?.();
    } catch {
      /* ignore */
    }
  } else {
    delete root.dataset.telegram;
  }

  applyTelegramInsets(wa);
  applyTelegramChrome(wa);

  if (!wa?.onEvent) return;
  const sync = (): void => {
    applyTelegramInsets(wa);
    applyTelegramChrome(wa);
  };
  for (const event of VIEWPORT_EVENTS) {
    wa.onEvent(event, sync);
  }
}
