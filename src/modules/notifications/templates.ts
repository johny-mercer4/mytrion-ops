/**
 * Bot-message templates, 4 languages, mirroring the mini-app i18n's tone. Interpolation is
 * {var} over the event payload. Security lives in the TEXTS themselves: cards are always
 * `•••• {last6}` (last-6 rule) and no template has a slot for a money-code value.
 *
 * Locale: the registration captures Telegram's language_code (registered_mini_app_companies),
 * and the dispatcher passes it here — normalizeLang() maps any IETF tag ('ru', 'uz-Cyrl',
 * 'pt-BR') to the nearest supported language, falling back to 'en'.
 *
 * A payload value may itself be a per-locale MAP ({en,ru,uz,es}) — e.g. a news post's title/body.
 * Interpolation picks the recipient's locale out of it (en fallback), so one outbox row renders
 * correctly for each recipient's language without storing a copy per language.
 */
type Lang = 'en' | 'ru' | 'uz' | 'es';
const LANGS: readonly Lang[] = ['en', 'ru', 'uz', 'es'];

/** Any Telegram language_code → a supported Lang. Primary subtag only; unknown → 'en'. */
export function normalizeLang(code: string | null | undefined): Lang {
  const primary = (code ?? '').toLowerCase().split(/[-_]/)[0] ?? '';
  return (LANGS as readonly string[]).includes(primary) ? (primary as Lang) : 'en';
}

const T: Record<string, Record<Lang, string>> = {
  moneyCode: {
    en: '💵 A money code was issued — open the mini-app to view it. {reason}',
    ru: '💵 Money code выпущен — откройте мини-приложение, чтобы посмотреть. {reason}',
    uz: "💵 Money code chiqarildi — ko'rish uchun mini-app'ni oching. {reason}",
    es: '💵 Se emitió un money code — ábralo en la mini-app. {reason}',
  },
  cardStatus: {
    en: '💳 Card •••• {last6} status changed: {prev} → {status}.',
    ru: '💳 Статус карты •••• {last6} изменился: {prev} → {status}.',
    uz: "💳 •••• {last6} karta holati o'zgardi: {prev} → {status}.",
    es: '💳 La tarjeta •••• {last6} cambió de estado: {prev} → {status}.',
  },
  limit: {
    en: '⛽ Card •••• {last6}: {used} of {limit} gallons used today ({pct}%).',
    ru: '⛽ Карта •••• {last6}: использовано {used} из {limit} галлонов сегодня ({pct}%).',
    uz: '⛽ •••• {last6}: bugun {limit} gallondan {used} tasi ishlatildi ({pct}%).',
    es: '⛽ Tarjeta •••• {last6}: {used} de {limit} galones usados hoy ({pct}%).',
  },
  statement: {
    en: '📄 Your weekly transaction statement is attached.',
    ru: '📄 Ваш еженедельный стейтмент во вложении.',
    uz: '📄 Haftalik statement biriktirildi.',
    es: '📄 Su estado de cuenta semanal está adjunto.',
  },
  receipt: {
    en: '🧾 Fueling: {gallons} gal at {location}, {city} {state} — card •••• {last6}.',
    ru: '🧾 Заправка: {gallons} гал., {location}, {city} {state} — карта •••• {last6}.',
    uz: "🧾 Yoqilg'i: {gallons} gal, {location}, {city} {state} — •••• {last6}.",
    es: '🧾 Carga: {gallons} gal en {location}, {city} {state} — tarjeta •••• {last6}.',
  },
  override: {
    en: 'Card •••• {last6} is overridden — you can fuel for about 30 minutes.',
    ru: 'Карта •••• {last6} разблокирована — можно заправляться около 30 минут.',
    uz: "•••• {last6} karta override qilindi — ~30 daqiqa yoqilg'i quyish mumkin.",
    es: 'La tarjeta •••• {last6} está desbloqueada — puede cargar unos 30 minutos.',
  },
  approval: {
    en: '🔔 {driverName} requests an emergency money code ({amount}). Open the mini-app to approve.',
    ru: '🔔 {driverName} запрашивает экстренный money code ({amount}). Откройте мини-приложение, чтобы подтвердить.',
    uz: "🔔 {driverName} favqulodda money code so'rayapti ({amount}). Tasdiqlash uchun mini-app'ni oching.",
    es: '🔔 {driverName} solicita un money code de emergencia ({amount}). Abra la mini-app para aprobar.',
  },
  debt: {
    en: '⚠️ {count} invoice(s) overdue — {total}. Please review Invoices in the mini-app.',
    ru: '⚠️ Просрочено счетов: {count} — {total}. Откройте Invoices в мини-приложении.',
    uz: "⚠️ {count} ta invoice muddati o'tgan — {total}. Mini-app'da Invoices'ni oching.",
    es: '⚠️ {count} factura(s) vencida(s) — {total}. Revise Invoices en la mini-app.',
  },
  tracking: {
    en: '📦 Card shipment update: {status} — {detail}.',
    ru: '📦 Доставка карты: {status} — {detail}.',
    uz: '📦 Karta yetkazish: {status} — {detail}.',
    es: '📦 Envío de tarjeta: {status} — {detail}.',
  },
  balanceLow: {
    en: '⚠️ EFS balance is low: {balance}. Cards may start declining.',
    ru: '⚠️ Баланс EFS низкий: {balance}. Карты могут начать отклоняться.',
    uz: '⚠️ EFS balans past: {balance}. Kartalar rad etilishi mumkin.',
    es: '⚠️ El saldo EFS es bajo: {balance}. Las tarjetas pueden ser rechazadas.',
  },
  news: {
    en: '📣 {title}\n\n{body}',
    ru: '📣 {title}\n\n{body}',
    uz: '📣 {title}\n\n{body}',
    es: '📣 {title}\n\n{body}',
  },
};

export function renderNotification(
  templateKey: string,
  lang: string | null | undefined,
  payload: Record<string, unknown>,
): string {
  const l = normalizeLang(lang);
  const tpl = T[templateKey]?.[l] ?? '';
  return tpl
    .replace(/\{(\w+)\}/g, (_, k: string) => localizeValue(payload[k], l))
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/** A payload slot is either a scalar or a per-locale map ({en,ru,…}) — resolve to a string. */
function localizeValue(v: unknown, l: Lang): string {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const m = v as Record<string, unknown>;
    return String(m[l] ?? m.en ?? '');
  }
  return String(v ?? '');
}
