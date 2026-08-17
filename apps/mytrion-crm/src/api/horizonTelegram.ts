/**
 * After Zoho login inside the Horizon Mini App, bind this Telegram user to the Zoho session.
 *
 * Failures must not block CRM use. initData is sent once as proof of the current Telegram user;
 * it is never treated as a login. impersonate:false so View-as cannot attach the admin's Telegram
 * to another worker.
 */
import { getSession } from './session';
import { request } from './transport';
import { getTelegramInitData, isTelegramWebView } from '../telegram/webApp';

const RETRY_DELAY_MS = 15_000;
const MAX_ATTEMPTS = 4;

let inFlight: Promise<boolean> | null = null;
let succeededForZoho: string | null = null;
let attempts = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

export function resetHorizonTelegramBind(): void {
  succeededForZoho = null;
  attempts = 0;
  inFlight = null;
  if (retryTimer !== null) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
}

function scheduleRetry(): void {
  if (retryTimer !== null || attempts >= MAX_ATTEMPTS) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void bindHorizonTelegramAfterLogin();
  }, RETRY_DELAY_MS);
}

export function bindHorizonTelegramAfterLogin(): Promise<boolean> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      if (!isTelegramWebView()) return false;
      const initData = getTelegramInitData();
      if (!initData) return false;
      const zohoUserId = getSession()?.worker.zohoUserId;
      if (!zohoUserId) return false;
      if (succeededForZoho === zohoUserId) return true;
      attempts += 1;
      try {
        await request('POST', '/horizon/telegram/link', {
          body: { initData },
          impersonate: false,
        });
        succeededForZoho = zohoUserId;
        return true;
      } catch {
        if (attempts < MAX_ATTEMPTS) scheduleRetry();
        return false;
      }
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}
