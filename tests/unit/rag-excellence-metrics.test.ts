import { describe, expect, it } from 'vitest';
import { ndcg, reciprocalRank } from '../../scripts/lib/ragExcellenceMetrics.js';

describe('RAG excellence metrics', () => {
  it('does not reward duplicate retrievals more than once', () => {
    expect(ndcg(['doc-a', 'doc-b'], ['doc-a', 'doc-a', 'doc-b'])).toBeLessThanOrEqual(1);
    expect(ndcg(['doc-a'], ['doc-a', 'doc-a'])).toBe(1);
  });

  it('uses the first matching evidence rank for reciprocal rank', () => {
    expect(reciprocalRank(['doc-b'], ['doc-a', 'doc-b'])).toBe(0.5);
  });
});
