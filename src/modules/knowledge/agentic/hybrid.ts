/**
 * Hybrid retrieval with reciprocal-rank fusion. Per sub-query: the vector leg and the
 * full-text leg run in parallel; candidates are fused with RRF (score = Σ 1/(K + rank))
 * and deduped by chunk id across all sub-queries. The full-text leg degrades to
 * vector-only when hybrid is off or the leg errors (e.g. migration not applied yet).
 */
import { env } from '../../../config/env.js';
import { logger } from '../../../lib/logger.js';
import {
  knowledgeSearchRepo,
  type HybridChunk,
} from '../../../repos/knowledgeSearchRepo.js';
import type { TenantContext } from '../../../types/tenantContext.js';
import { embedQuery } from '../embedder.js';
import type { RetrievedPassage } from './types.js';

async function fullTextLeg(ctx: TenantContext, query: string, k: number): Promise<HybridChunk[]> {
  if (!env.FF_RAG_HYBRID) return [];
  try {
    return await knowledgeSearchRepo.searchFullText(ctx, query, k);
  } catch (err) {
    logger.warn({ err }, 'full-text retrieval leg failed; continuing vector-only');
    return [];
  }
}

/** Fuse leg rankings for one or more sub-queries into a deduped, RRF-scored candidate list. */
export async function hybridRetrieve(
  ctx: TenantContext,
  queries: string[],
  candidatesPerLeg = env.RAG_CANDIDATES_PER_LEG,
): Promise<RetrievedPassage[]> {
  const byId = new Map<string, RetrievedPassage>();

  const addRanking = (chunks: HybridChunk[]): void => {
    chunks.forEach((chunk, rank) => {
      // Stale docs (past expiry / unverified beyond STALE_DOC_DAYS) count half.
      const staleFactor = chunk.stale ? 0.5 : 1;
      const increment = staleFactor / (env.RAG_RRF_K + rank + 1);
      const existing = byId.get(chunk.id);
      if (existing) {
        existing.fusedScore += increment;
      } else {
        byId.set(chunk.id, { ...chunk, fusedScore: increment });
      }
    });
  };

  for (const query of queries) {
    const [vectorChunks, textChunks] = await Promise.all([
      embedQuery(query).then((embedding) =>
        knowledgeSearchRepo.searchVector(ctx, embedding, candidatesPerLeg),
      ),
      fullTextLeg(ctx, query, candidatesPerLeg),
    ]);
    addRanking(vectorChunks);
    addRanking(textChunks);
  }

  return [...byId.values()].sort((a, b) => b.fusedScore - a.fusedScore);
}
