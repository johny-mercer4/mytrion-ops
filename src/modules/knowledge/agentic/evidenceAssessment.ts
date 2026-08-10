import { env } from '../../../config/env.js';
import type { RetrievedPassage } from './types.js';

export type EvidenceGrade =
  | 'sufficient'
  | 'partial'
  | 'irrelevant'
  | 'conflict'
  | 'outdated'
  | 'not_documented';

export interface EvidenceAssessment {
  grade: EvidenceGrade;
  confidence: number;
  reasons: string[];
}

/** Calibratable evidence signals; no model may certify its own authority or scope. */
export function assessEvidence(passages: RetrievedPassage[]): EvidenceAssessment {
  if (passages.length === 0) {
    return { grade: 'not_documented', confidence: 1, reasons: ['no eligible candidates'] };
  }
  const top = passages[0];
  if (!top) return { grade: 'not_documented', confidence: 1, reasons: ['no top candidate'] };
  const fresh = passages.filter((passage) => !passage.stale);
  if (fresh.length === 0) {
    return { grade: 'outdated', confidence: 0.9, reasons: ['all candidates are stale or expired'] };
  }
  const vector = top.signals?.bestVectorScore ?? (top.score >= -1 && top.score <= 1 ? top.score : undefined);
  const agreement = (top.signals?.vectorHits ?? 0) > 0 && (top.signals?.lexicalHits ?? 0) > 0;
  const multiQuery = (top.signals?.queryHits ?? 0) >= 2;
  if (vector !== undefined && vector >= env.RAG_MIN_COSINE_SCORE && (agreement || multiQuery)) {
    /**
     * Corroboration is evidence, so it moves confidence — it used to only gate this branch.
     *
     * That mattered once the lexical leg started working. While `buildFullTextQuery` returned zero
     * rows for natural-language questions, `agreement` was unreachable, so the only route to the
     * `shouldUseDeterministic` bar (0.85) was a cosine ≥ 0.733 — rare in practice. Every question
     * therefore paid for a semantic judge call plus a corrective hop.
     *
     * Two retrieval methods independently surfacing the same chunk is the standard hybrid-search
     * precision signal, and a chunk found by several rewrites of the question is nearly as strong.
     * Measured cosine for on-target Sales documents runs 0.54–0.82, so a modest bump lets a
     * genuinely strong match skip grading while weak or conflicting evidence still gets judged.
     */
    const corroboration = (agreement ? 0.06 : 0) + (multiQuery ? 0.03 : 0);
    return {
      grade: 'sufficient',
      confidence: Math.min(
        0.98,
        0.78 + Math.max(0, vector - env.RAG_MIN_COSINE_SCORE) * 0.3 + corroboration,
      ),
      reasons: [
        'strong semantic match',
        ...(agreement ? ['vector/lexical agreement'] : []),
        ...(multiQuery ? ['multi-query agreement'] : []),
      ],
    };
  }
  if (vector !== undefined && vector < env.RAG_MIN_COSINE_SCORE && !agreement) {
    return { grade: 'irrelevant', confidence: 0.8, reasons: ['weak semantic match without lexical agreement'] };
  }
  return { grade: 'partial', confidence: 0.62, reasons: ['candidate evidence requires semantic grading'] };
}
