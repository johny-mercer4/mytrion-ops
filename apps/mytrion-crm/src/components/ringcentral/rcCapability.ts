import { isTelegramWebView } from '../../telegram/webApp';

/**
 * Embeddable is an iframe + WebRTC + an OAuth popup. Telegram's WebView does not reliably
 * allow any of those, so in-app calling is desktop / mobile-browser only.
 */
export function inAppCallingSupported(): boolean {
  return !isTelegramWebView();
}
