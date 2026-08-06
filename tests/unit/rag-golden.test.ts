import { describe, expect, it } from 'vitest';
import { HORIZON_RAG_GOLDEN_V1 } from '../fixtures/horizon-rag-golden.js';
import { routeRetrievalIntent } from '../../src/modules/knowledge/agentic/router.js';

describe('Horizon RAG golden set v1', () => {
  it('contains 200 unique, sanitized, versioned requests', () => {
    expect(HORIZON_RAG_GOLDEN_V1).toHaveLength(200);
    expect(new Set(HORIZON_RAG_GOLDEN_V1.map((item) => item.id)).size).toBe(200);
    expect(new Set(HORIZON_RAG_GOLDEN_V1.map((item) => item.request)).size).toBe(200);
    expect(HORIZON_RAG_GOLDEN_V1.every((item) => item.origin === 'sanitized-synthetic')).toBe(true);
    expect(HORIZON_RAG_GOLDEN_V1.every((item) => item.schemaVersion === '1')).toBe(true);
  });

  it('covers required adversarial and operational query classes', () => {
    const categories = new Set(HORIZON_RAG_GOLDEN_V1.map((item) => item.category));
    for (const category of [
      'sop', 'platform', 'identifier', 'acronym', 'multilingual', 'multiturn', 'compound',
      'numeric-tool', 'corpus-dark', 'stale-conflict', 'casual', 'wrong-premise',
      'injection', 'rbac', 'external', 'platform-rbac',
    ]) expect(categories).toContain(category);
  });

  it('meets the 98% deterministic routing promotion gate', () => {
    const correct = HORIZON_RAG_GOLDEN_V1.filter((item) =>
      routeRetrievalIntent(item.request).route === item.expectedRoute,
    ).length;
    expect(correct / HORIZON_RAG_GOLDEN_V1.length).toBeGreaterThanOrEqual(0.98);
  });
});
