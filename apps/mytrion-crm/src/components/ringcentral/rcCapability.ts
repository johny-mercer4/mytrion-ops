import { isTelegramWebView } from '../../telegram/webApp';

/**
 * Embeddable is an iframe + WebRTC + an OAuth popup. Telegram's WebView does not reliably
 * allow any of those. Never inject adapter.js there — CSS-hiding the pill still leaves a
 * vendor popup. Desktop / mobile-browser calling is unchanged.
 */
export function inAppCallingSupported(): boolean {
  return !isTelegramWebView();
}
