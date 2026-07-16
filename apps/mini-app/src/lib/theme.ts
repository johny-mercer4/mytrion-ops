/**
 * Theme is the user's explicit choice (a toggle in the profile menu), persisted across opens —
 * not the phone's OS theme and not Telegram's. We write <html data-theme> for our own tokens (see
 * styles/global.css) AND ask Telegram to paint its own header/background/bottom bar to match, so
 * the app and Telegram's surrounding chrome never disagree.
 */
import { getTelegramWebApp } from './telegram';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'octane.theme';

// Must track the --card (header) and --background tokens in styles/global.css so Telegram's own
// chrome and the app's surfaces are the same color.
const CHROME: Record<Theme, { header: string; bg: string }> = {
  light: { header: '#ffffff', bg: '#f4f5f7' },
  dark: { header: '#161922', bg: '#0b0c10' },
};

export function getStoredTheme(): Theme {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'light' || v === 'dark') return v;
  } catch {
    // private mode / storage disabled — fall through to the default
  }
  return 'dark';
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset['theme'] = theme;
  const wa = getTelegramWebApp();
  const c = CHROME[theme];
  wa?.setHeaderColor?.(c.header);
  wa?.setBackgroundColor?.(c.bg);
  wa?.setBottomBarColor?.(c.header);
}

export function setTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // ignore — theme just won't persist
  }
  applyTheme(theme);
}

/**
 * Apply the stored theme on boot and keep re-applying our chrome colors when Telegram fires
 * themeChanged (which resets its own chrome to the Telegram theme, undoing ours).
 */
export function initTheme(): Theme {
  const theme = getStoredTheme();
  applyTheme(theme);
  getTelegramWebApp()?.onEvent?.('themeChanged', () => applyTheme(getStoredTheme()));
  return theme;
}
