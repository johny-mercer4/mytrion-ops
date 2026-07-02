/**
 * The agentic retrieval loop: plan sub-queries → hybrid retrieve → assess sufficiency →
 * refine and re-retrieve (bounded by RAG_MAX_HOPS) → optional rerank → grounding block with
 * citations. Every hop retrieves under the SAME (or narrower) TenantContext — reformulation
 * cannot widen access because filters live in the repo layer.
 */
import { env } from '../../../config/env.js';
import type { TenantContext } from '../../../types/tenantContext.js';
import { hybridRetrieve } from './hybrid.js';
import { buildGroundingBlock } from './citations.js';
import { judgeSufficiency, planQueries } from './queryPlanner.js';
import { rerankPassages } from './rerank.js';
import type { AgenticRetrievalResult, RetrievedPassage } from './types.js';

export async function agenticRetrieve(
  ctx: TenantContext,
  question: string,
  opts: { k?: number } = {},
): Promise<AgenticRetrievalResult> {
  const k = opts.k ?? 6;
  let queries = await planQueries(question);
  let candidates: RetrievedPassage[] = [];
  let hops = 0;
  let sufficient = false;

  while (hops < env.RAG_MAX_HOPS) {
    hops += 1;
    const found = await hybridRetrieve(ctx, queries);
    // Merge with prior hops (dedupe by id; keep the higher fused score).
    const byId = new Map(candidates.map((p) => [p.id, p]));
    for (const p of found) {
      const existing = byId.get(p.id);
      if (!existing || p.fusedScore > existing.fusedScore) byId.set(p.id, p);
    }
    candidates = [...byId.values()].sort((a, b) => b.fusedScore - a.fusedScore);

    if (candidates.length === 0) {
      // Nothing at all — one refinement try, then give up to the caller (web search etc.).
      if (hops >= env.RAG_MAX_HOPS) break;
      queries = [question];
      continue;
    }
    // Strong top hit → skip the judge (saves a model call on easy questions).
    if ((candidates[0]?.fusedScore ?? 0) >= env.RAG_SUFFICIENT_SCORE) {
      sufficient = true;
      break;
    }
    const verdict = await judgeSufficiency(question, candidates.slice(0, k));
    if (verdict.sufficient || verdict.missingQueries.length === 0) {
      sufficient = verdict.sufficient;
      break;
    }
    queries = verdict.missingQueries;
  }

  const passages = await rerankPassages(question, candidates, k);
  const { groundingBlock, citations } = buildGroundingBlock(passages);
  return {
    passages,
    citations,
    groundingBlock,
    hops,
    sufficient: sufficient || passages.length > 0,
    suggestWebSearch: passages.length === 0 || (!sufficient && passages.length < Math.min(3, k)),
  };
}
