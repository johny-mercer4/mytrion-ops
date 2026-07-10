/**
 * DEV ONLY — when the app is opened in a plain browser (not the Telegram client) with
 * `?token=<id>&dev=1`, install a mock `window.Telegram.WebApp` whose `initData` is a real,
 * backend-signed payload for a fake user. This lets the full flow (confirm → redeem → fleet) be
 * clicked through locally. The whole module is behind `import.meta.env.DEV`, so it is
 * dead-code-eliminated from the production build.
 */
import type { TelegramWebApp, TelegramWebAppUser } from './telegram';

export async function installDevTelegram(): Promise<void> {
  if (!import.meta.env.DEV) return;
  // The Telegram SDK script (index.html) always creates window.Telegram.WebApp — but with an EMPTY
  // initData outside the real client. Only a non-empty initData means we're genuinely in Telegram;
  // in that case never override it.
  if (window.Telegram?.WebApp?.initData) return;
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');
  if (!token || params.get('dev') !== '1') return; // strictly opt-in

  const base = (import.meta.env.VITE_API_URL ?? '').trim();
  const uid = params.get('uid'); // optional: pick a distinct fake user so multiple roles are testable
  const lang = params.get('lang'); // optional: seed the Telegram user's language_code
  const q = new URLSearchParams();
  if (uid) q.set('id', uid);
  if (lang) q.set('language_code', lang);
  try {
    const res = (await fetch(`${base}/v1/carrier-invitations/dev/mock-init-data?${q}`).then((r) => r.json())) as {
      initData: string;
      user: TelegramWebAppUser;
    };
    const noop = (): void => {};
    const mock: TelegramWebApp = {
      initData: res.initData,
      initDataUnsafe: { start_param: token, user: res.user },
      ready: noop,
      expand: noop,
      onEvent: noop,
      setHeaderColor: noop,
      setBackgroundColor: noop,
      setBottomBarColor: noop,
      HapticFeedback: { impactOccurred: noop, notificationOccurred: noop },
    };
    window.Telegram = { WebApp: mock };
  } catch {
    /* leave Telegram unset — the app falls back to its normal outside-Telegram state */
  }
}
