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

/**
 * Corroboration calibration. The lexical leg silently returned zero rows for every
 * natural-language question (websearch AND semantics + the stop-word-preserving `simple` config),
 * so `agreement` was unreachable and confidence could only pass shouldUseDeterministic's 0.85 bar at
 * cosine >= 0.733. Every question paid for a judge call and a corrective hop it did not need.
 */
describe('assessEvidence — corroboration raises confidence', () => {
  const passage = (over: Partial<RetrievedPassage> = {}): RetrievedPassage =>
    ({
      id: 'c1',
      docId: 'd1',
      chunkIndex: 0,
      content: 'x',
      score: 0.6,
      fusedScore: 0.02,
      stale: false,
      signals: { vectorHits: 1, lexicalHits: 0, queryHits: 1, bestVectorScore: 0.6 },
      ...over,
    }) as RetrievedPassage;

  const DETERMINISTIC_BAR = 0.85;

  it('a vector-only hit cannot be certified sufficient (needs corroboration)', () => {
    const out = assessEvidence([passage()]);
    expect(out.grade).toBe('partial');
  });

  it('vector + lexical agreement certifies and clears the deterministic bar', () => {
    const out = assessEvidence([
      passage({ signals: { vectorHits: 1, lexicalHits: 1, queryHits: 1, bestVectorScore: 0.6 } }),
    ]);
    expect(out.grade).toBe('sufficient');
    expect(out.reasons).toContain('vector/lexical agreement');
    // 0.78 + (0.6-0.5)*0.3 + 0.06 = 0.87 — the real Sales range (0.54–0.82 cosine) now skips grading.
    expect(out.confidence).toBeGreaterThanOrEqual(DETERMINISTIC_BAR);
  });

  it('multi-query agreement alone certifies but scores below vector/lexical agreement', () => {
    const multi = assessEvidence([
      passage({ signals: { vectorHits: 1, lexicalHits: 0, queryHits: 2, bestVectorScore: 0.6 } }),
    ]);
    const both = assessEvidence([
      passage({ signals: { vectorHits: 1, lexicalHits: 1, queryHits: 2, bestVectorScore: 0.6 } }),
    ]);
    expect(multi.grade).toBe('sufficient');
    expect(multi.reasons).toContain('multi-query agreement');
    expect(both.confidence).toBeGreaterThan(multi.confidence);
  });

  it('never exceeds 0.98 however corroborated', () => {
    const out = assessEvidence([
      passage({ signals: { vectorHits: 1, lexicalHits: 1, queryHits: 3, bestVectorScore: 0.99 } }),
    ]);
    expect(out.confidence).toBeLessThanOrEqual(0.98);
  });

  it('corroboration cannot rescue a match below the cosine floor', () => {
    const out = assessEvidence([
      passage({ score: 0.2, signals: { vectorHits: 1, lexicalHits: 1, queryHits: 3, bestVectorScore: 0.2 } }),
    ]);
    expect(out.grade).not.toBe('sufficient');
  });

  it('stale-only evidence stays outdated regardless of corroboration', () => {
    const out = assessEvidence([
      passage({ stale: true, signals: { vectorHits: 1, lexicalHits: 1, queryHits: 3, bestVectorScore: 0.9 } }),
    ]);
    expect(out.grade).toBe('outdated');
  });
});
