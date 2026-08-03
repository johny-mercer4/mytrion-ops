/**
 * Telegram users often compose one request as a greeting, subject, date range and modifier in
 * separate messages. Keep obvious multi-part starts open a little longer without adding latency
 * to ordinary complete questions.
 */
const GREETING_ONLY = /^(?:a(?:ss?alomu?\s+al[ae]ykum|salom)|salom|hi|hello|hey|привет|здравствуйте|добрый\s+(?:день|вечер|утро))[!.?,\s]*$/iu;
const REPORT_LEAD = /(?:^|\s)(?:statement|report|hisobot|отч[её]т|invoice|transactions?|tranzaksiy(?:a|alar))(?:\s|$)/iu;
const DETAIL_FRAGMENT = /^(?:with|without|only|faqat|только|за|from|to|unit|truck|card|format|pdf|excel|xlsx|csv|\d{1,2}[./-]\d{1,2}[./-]\d{2,4})(?:\s|$)/iu;

export function messageCollectionQuietMs(
  texts: readonly string[],
  baseQuietMs: number,
): number {
  const normalized = texts.map((text) => text.trim()).filter(Boolean);
  const latest = normalized.at(-1) ?? '';

  // Once a second fragment arrives, allow the user to append another scope/date/format detail.
  if (normalized.length > 1) return Math.max(baseQuietMs, 7_000);
  // A greeting commonly precedes the actual request in the next Telegram message.
  if (GREETING_ONLY.test(latest)) return Math.max(baseQuietMs, 10_000);
  // Reports are routinely followed by a scope, date range and output/column requirements.
  if (REPORT_LEAD.test(latest)) return Math.max(baseQuietMs, 10_000);
  // A standalone modifier usually belongs to a request immediately before/after it.
  if (DETAIL_FRAGMENT.test(latest)) return Math.max(baseQuietMs, 7_000);
  return baseQuietMs;
}
