import { describe, expect, it } from 'vitest';
import { assessEvidence } from '../../src/modules/knowledge/agentic/evidenceAssessment.js';
import type { RetrievedPassage } from '../../src/modules/knowledge/agentic/types.js';

function passage(overrides: Partial<RetrievedPassage> = {}): RetrievedPassage {
  return {
    id: 'chunk-1',
    docId: 'doc-1',
    docTitle: 'Verified policy',
    chunkIndex: 0,
    content: 'Verified supporting evidence.',
    departmentAccess: 'sales',
    stale: false,
    score: 0.8,
    fusedScore: 0.03,
    ...overrides,
  };
}

describe('CRAG evidence assessment', () => {
  it('reports a corpus miss instead of inventing an answer', () => {
    expect(assessEvidence([])).toMatchObject({ grade: 'not_documented', confidence: 1 });
  });

  it('labels an all-stale result set as outdated', () => {
    expect(assessEvidence([passage({ stale: true })]).grade).toBe('outdated');
  });

  it('accepts strong cross-leg agreement as sufficient', () => {
    expect(assessEvidence([passage({
      signals: { vectorHits: 1, lexicalHits: 1, queryHits: 1, bestVectorScore: 0.82 },
    })])).toMatchObject({ grade: 'sufficient' });
  });

  it('rejects weak semantic evidence without lexical agreement', () => {
    expect(assessEvidence([passage({
      score: 0.1,
      signals: { vectorHits: 1, lexicalHits: 0, queryHits: 1, bestVectorScore: 0.1 },
    })])).toMatchObject({ grade: 'irrelevant' });
  });
});
