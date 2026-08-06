/**
 * Shared types for the agentic retrieval loop. The planner/judge LLMs only ever produce query
 * STRINGS and yes/no judgments — access filters live in the repo layer (departmentFilter), so
 * no LLM output can widen retrieval scope.
 */
import type { HybridChunk } from '../../../repos/knowledgeSearchRepo.js';
import type { EvidenceGrade } from './evidenceAssessment.js';

export interface RetrievedPassage extends HybridChunk {
  /** Reciprocal-rank-fusion score across all sub-queries and legs. Higher = better. */
  fusedScore: number;
  signals?: {
    vectorHits: number;
    lexicalHits: number;
    queryHits: number;
    bestVectorScore?: number;
    bestLexicalScore?: number;
  };
}

export interface Citation {
  /** Stable marker used in the grounding block and expected in answers, e.g. 'S1'. */
  marker: string;
  docId: string;
  docTitle: string | null;
  chunkIndex: number;
  sourceVersion?: string;
  authorityClass?: string;
  verificationStatus?: string;
  lastVerifiedAt?: string;
  stale?: boolean;
}

export interface AgenticRetrievalResult {
  passages: RetrievedPassage[];
  citations: Citation[];
  /** The ready-to-inject system grounding block (UNTRUSTED-wrapped, citation-marked). */
  groundingBlock: string;
  hops: number;
  sufficient: boolean;
  /** CRAG ternary grade from the last judge (or Correct on score short-circuit). */
  grade: EvidenceGrade;
  /** Set when the loop exhausted without Correct — caller may web-fallback or abstain. */
  suggestWebSearch: boolean;
  /** True when the KB cannot answer and generation must abstain. */
  notDocumented: boolean;
  /** Optional UNTRUSTED web snippet appended after CRAG web fallback. */
  webFallbackBlock?: string;
  traceId: string;
  /** Server-only fingerprint of the exact eligible retrieval scope. */
  scopeFingerprint: string;
  confidence: number;
  route: 'none' | 'knowledge' | 'tool' | 'external';
}
