export type RetrievalRoute = 'none' | 'knowledge' | 'tool' | 'external';

export interface RetrievalRouteDecision {
  route: RetrievalRoute;
  reason: string;
  platformPreferred: boolean;
}

const GREETING_PREFIX = /^(hi|hello|hey|thanks|thank you|yo|salom|rahmat|привет|спасибо|доброе утро|good (morning|afternoon|evening))(?=$|[!.\s])[!.\s]*/iu;
const TOOL_AGGREGATE = /(?:\b(how many|count|total|sum|average|balance|transactions?|invoices?|gallons?|swipes?|leads?|deals?|clients?|qancha|balans|gallon\w*|mijoz\w*)\b|(?<!\p{L})(сколько|баланс|сумм\p{L}*|средн\p{L}*|галлон\p{L}*|клиент\p{L}*)(?!\p{L}))/iu;
const LIVE_SCOPE = /(?:\b(my|our|today|week|month|carrier|account|portfolio|crm|bu oy|joriy|mening|bizning|mijozlarim|carrierim)\b|(?<!\p{L})(мо[йияе]|наши?|текущ\p{L}*|сегодня|недел\p{L}*|месяц\p{L}*|перевозчик\p{L}*)(?!\p{L}))/iu;
const PLATFORM = /\b(horizon|mytrion|octane assistant|platform|agent|tool|integration|feature|permission|capabilit|what can you do)\b/i;
const EXTERNAL = /\b(public web|search the web|latest news|industry news|fmcsa|irs|government website|outside octane|external source)\b/i;
const INTERNAL = /\b(octane|horizon|mytrion|sop|policy|procedure|pricing|fuel card|department|workflow)\b/i;

/** Zero-cost first router. Ambiguous calls remain knowledge and are corrected by CRAG. */
export function routeRetrievalIntent(query: string): RetrievalRouteDecision {
  const clean = query.trim();
  const afterGreeting = clean.replace(GREETING_PREFIX, '');
  if (!clean || (afterGreeting !== clean && !/[?]/.test(afterGreeting) && !INTERNAL.test(afterGreeting) && !PLATFORM.test(afterGreeting) && !TOOL_AGGREGATE.test(afterGreeting))) {
    return { route: 'none', reason: 'casual-or-empty', platformPreferred: false };
  }
  const platformPreferred = PLATFORM.test(clean);
  if (EXTERNAL.test(clean) && !INTERNAL.test(clean)) {
    return { route: 'external', reason: 'explicit-external-intent', platformPreferred };
  }
  if (TOOL_AGGREGATE.test(clean) && LIVE_SCOPE.test(clean)) {
    return { route: 'tool', reason: 'authoritative-live-aggregate', platformPreferred };
  }
  return { route: 'knowledge', reason: platformPreferred ? 'platform-knowledge' : 'proprietary-knowledge', platformPreferred };
}
