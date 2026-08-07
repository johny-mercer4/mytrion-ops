/**
 * An explicit `knowledge_search` call must not be refused by the intent router.
 *
 * `routeRetrievalIntent` judges a USER utterance: "how do I…" stays on knowledge, "how many gallons
 * this month" goes to a live tool. But `scopedRag` passes the MODEL's keyword query
 * ("client balance account cards"), which carries no procedural markers and therefore reads as a
 * live-data aggregate. Measured: "How do I check a client's balance and see their card list?" ended as
 * `route: tool, abstained: true, hops: 0` in 3ms, and the answer cited nothing.
 *
 * Deciding not to retrieve belongs to the chat layer, before the tool is called. Once the model has
 * called it, the request is honoured.
 */
import { describe, expect, it } from 'vitest';
import { routeRetrievalIntent } from '../../src/modules/knowledge/agentic/router.js';

/** The coercion `agenticRetrieve` applies — kept in sync with loop.ts. */
function effectiveRoute(query: string, explicitKnowledgeRequest: boolean): string {
  const routed = routeRetrievalIntent(query);
  return explicitKnowledgeRequest && routed.route === 'tool' ? 'knowledge' : routed.route;
}

describe('explicit knowledge_search requests are not abstained', () => {
  // A keyword query the model would realistically emit for the balance+cards question.
  const modelQuery = 'client balance account card list';

  it('the bare router would send this keyword query to a live tool', () => {
    expect(routeRetrievalIntent(modelQuery).route).toBe('tool');
  });

  it('an explicit tool call overrides that and retrieves', () => {
    expect(effectiveRoute(modelQuery, true)).toBe('knowledge');
  });

  it('the chat layer (not an explicit tool call) still routes to the live tool', () => {
    expect(effectiveRoute(modelQuery, false)).toBe('tool');
  });

  it('casual/empty still abstains even for an explicit call — searching a greeting is waste', () => {
    expect(effectiveRoute('hello', true)).toBe('none');
  });

  it('external intent is untouched by the override', () => {
    expect(effectiveRoute('search the public web for the latest FMCSA news', true)).toBe('external');
  });
});
