export type RetrievalRoute = 'none' | 'knowledge' | 'tool' | 'external';

export interface RetrievalRouteDecision {
  route: RetrievalRoute;
  reason: string;
  platformPreferred: boolean;
}

const GREETING_PREFIX = /^(hi|hello|hey|thanks|thank you|yo|salom|rahmat|привет|спасибо|доброе утро|good (morning|afternoon|evening))(?=$|[!.\s])[!.\s]*/iu;
const TOOL_AGGREGATE = /(?:\b(how many|count|total|sum|average|balance|transactions?|invoices?|gallons?|swipes?|leads?|deals?|clients?|qancha|balans|gallon\w*|mijoz\w*)\b|(?<!\p{L})(сколько|баланс|сумм\p{L}*|средн\p{L}*|галлон\p{L}*|клиент\p{L}*)(?!\p{L}))/iu;
const LIVE_SCOPE = /(?:\b(my|our|today|week|month|carrier|account|portfolio|crm|bu oy|joriy|mening|bizning|mijozlarim|carrierim)\b|(?<!\p{L})(мо[йияе]|наши?|текущ\p{L}*|сегодня|недел\p{L}*|месяц\p{L}*|перевозчик\p{L}*)(?!\p{L}))/iu;
const PLATFORM =
  /\b(horizon|mytrion|octane assistant|platform|agent|tool|integration|feature|permission|capabilit|what can you do|automations?|open pool|data center|call hub|my tasks)\b|\b[CQVM]-\d{1,2}\b/i;
/**
 * Actions that map to a live Sales Mytrion Automation block. A bare "how do I activate a card"
 * must reach the governed Automation document rather than the unverified operations handbook whose
 * table of contents is lexically dense with the same words. Only a hop-1 domain bias — the loop
 * broadens to every domain when platform evidence is not sufficient.
 */
const SALES_AUTOMATION_ACTION =
  /\b(activate|activation|deactivate|deactivation|fraud hold|override the card|money code|card replacement|replacement card|reactivate|reactivation|tracking number|billing form|driver id|unit number|fuel limit|card limit|boca|wex task|efs login|emanager|last used|card status|card roster)\b/i;
/**
 * Procedural intent ("how do I …", "which tab …"). Wins over TOOL_AGGREGATE so a how-to that merely
 * names an entity — "activate a card for my client", "request invoices for a carrier" — retrieves the
 * documented workflow instead of being sent to a live-data tool and answered "not documented".
 */
const PROCEDURAL =
  /(?:\bhow (?:do|can|would|should) (?:i|we|you)\b|\bhow to\b|\bwhere (?:do|can) (?:i|we)\b|\bwhere is\b|\bwhich (?:tab|section|screen|page|block|automation)\b|\bwhat are the steps\b|\bsteps? to\b|\bwalk me through\b|\bguide me\b|\bwhat (?:are|is) my options?\b|\bwhat can i do\b|\bmy options\b|(?<!\p{L})как(?!\s+(?:много|долго))(?!\p{L})|(?<!\p{L})где(?!\p{L})|(?<!\p{L})qanday(?!\p{L})|(?<!\p{L})qayerda(?!\p{L}))/iu;
const EXTERNAL = /\b(public web|search the web|latest news|industry news|fmcsa|irs|government website|outside octane|external source)\b/i;
const INTERNAL = /\b(octane|horizon|mytrion|sop|policy|procedure|pricing|fuel card|department|workflow)\b/i;

/** Zero-cost first router. Ambiguous calls remain knowledge and are corrected by CRAG. */
export function routeRetrievalIntent(query: string): RetrievalRouteDecision {
  const clean = query.trim();
  const afterGreeting = clean.replace(GREETING_PREFIX, '');
  if (!clean || (afterGreeting !== clean && !/[?]/.test(afterGreeting) && !INTERNAL.test(afterGreeting) && !PLATFORM.test(afterGreeting) && !TOOL_AGGREGATE.test(afterGreeting))) {
    return { route: 'none', reason: 'casual-or-empty', platformPreferred: false };
  }
  const platformPreferred = PLATFORM.test(clean) || SALES_AUTOMATION_ACTION.test(clean);
  if (EXTERNAL.test(clean) && !INTERNAL.test(clean)) {
    return { route: 'external', reason: 'explicit-external-intent', platformPreferred };
  }
  if (TOOL_AGGREGATE.test(clean) && LIVE_SCOPE.test(clean) && !PROCEDURAL.test(clean)) {
    return { route: 'tool', reason: 'authoritative-live-aggregate', platformPreferred };
  }
  return { route: 'knowledge', reason: platformPreferred ? 'platform-knowledge' : 'proprietary-knowledge', platformPreferred };
}
