import { describe, expect, it } from 'vitest';
import { routeRetrievalIntent } from '../../src/modules/knowledge/agentic/router.js';

describe('bounded RAG intent router', () => {
  it.each(['Hello!', 'Rahmat', 'Привет! Ответь кратко.'])('skips RAG for casual traffic: %s', (query) => {
    expect(routeRetrievalIntent(query).route).toBe('none');
  });

  it.each([
    'How many gallons did my clients use this month?',
    'Сколько галлонов использовали мои клиенты в этом месяце?',
    'Bu oy mijozlarim qancha gallon ishlatdi?',
  ])('routes authoritative live aggregates to tools: %s', (query) => {
    expect(routeRetrievalIntent(query).route).toBe('tool');
  });

  it('never treats an internal freshness request as public-web intent', () => {
    expect(routeRetrievalIntent('Find the latest Octane billing policy').route).toBe('knowledge');
  });

  it('allows external retrieval only when the request is explicit and non-internal', () => {
    expect(routeRetrievalIntent('Search the public web for the latest FMCSA news').route).toBe('external');
  });

  it('prioritizes the governed platform domain for Horizon capability questions', () => {
    expect(routeRetrievalIntent('Which tools can Horizon use?')).toMatchObject({
      route: 'knowledge',
      platformPreferred: true,
    });
  });
});
