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

  // A how-to that names an entity ("client", "invoices", "carrier") used to satisfy both
  // TOOL_AGGREGATE and LIVE_SCOPE and route to a live tool, so the documented Sales Mytrion
  // workflow was never retrieved and Horizon answered "not documented".
  it.each([
    'How do I activate a card for my client?',
    'how do I request invoices for a carrier',
    'How can I check the balance of my client?',
    'Where do I find my deals in Sales Mytrion?',
    'Как активировать карту для моего клиента?',
    'Mijozim uchun kartani qanday faollashtiraman?',
  ])('keeps a procedural how-to on the knowledge route: %s', (query) => {
    expect(routeRetrievalIntent(query).route).toBe('knowledge');
  });

  it('still routes a genuine live aggregate to tools when it is not procedural', () => {
    expect(routeRetrievalIntent('How many cards does my client have?').route).toBe('tool');
    expect(routeRetrievalIntent('What is the total balance for my carrier this month?').route).toBe(
      'tool',
    );
  });

  it.each([
    'What does Automation C-16 do?',
    'How do I claim from the Open Pool?',
    'Where is Data Center?',
    'What is on my Call Hub?',
  ])('prefers the platform domain for Sales Mytrion surfaces and service codes: %s', (query) => {
    expect(routeRetrievalIntent(query).platformPreferred).toBe(true);
  });
});
