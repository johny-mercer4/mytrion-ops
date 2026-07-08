/**
 * Shared types for the agentic retrieval loop. The planner/judge LLMs only ever produce query
 * STRINGS and yes/no judgments — access filters live in the repo layer (departmentFilter), so
 * no LLM output can widen retrieval scope.
 */
import type { HybridChunk } from '../../../repos/knowledgeSearchRepo.js';

export interface RetrievedPassage extends HybridChunk {
  /** Reciprocal-rank-fusion score across all sub-queries and legs. Higher = better. */
  fusedScore: number;
}

export interface Citation {
  /** Stable marker used in the grounding block and expected in answers, e.g. 'S1'. */
  marker: string;
  docId: string;
  docTitle: string | null;
  chunkIndex: number;
}

export interface AgenticRetrievalResult {
  passages: RetrievedPassage[];
  citations: Citation[];
  /** The ready-to-inject system grounding block (UNTRUSTED-wrapped, citation-marked). */
  groundingBlock: string;
  hops: number;
  sufficient: boolean;
  /** Set when the loop exhausted without sufficiency — the CALLER decides on web fallback. */
  suggestWebSearch: boolean;
}
