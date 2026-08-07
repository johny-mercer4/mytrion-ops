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
  type RetrievalScope,
} from '../../../repos/knowledgeSearchRepo.js';
import type { TenantContext } from '../../../types/tenantContext.js';
import { embedQuery } from '../embedder.js';
import type { RetrievedPassage } from './types.js';

async function fullTextLeg(ctx: TenantContext, query: string, k: number, scope?: RetrievalScope): Promise<HybridChunk[]> {
  if (!env.FF_RAG_HYBRID) return [];
  try {
    return await knowledgeSearchRepo.searchFullText(ctx, query, k, scope);
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
  scope?: RetrievalScope,
): Promise<RetrievedPassage[]> {
  const byId = new Map<string, RetrievedPassage>();
  const seenQueryForKey = new Map<string, Set<number>>();

  const addRanking = (chunks: HybridChunk[], leg: 'vector' | 'lexical', queryIndex: number): void => {
    chunks.forEach((chunk, rank) => {
      // Stale docs (past expiry / unverified beyond STALE_DOC_DAYS) count half.
      const staleFactor = chunk.stale ? 0.5 : 1;
      const increment = staleFactor / (env.RAG_RRF_K + rank + 1);
      const dedupeKey = chunk.contentHash ? `${chunk.docId}:${chunk.contentHash}` : chunk.id;
      const existing = byId.get(dedupeKey);
      if (existing) {
        existing.fusedScore += increment;
        const signals = (existing.signals ??= { vectorHits: 0, lexicalHits: 0, queryHits: 0 });
        if (leg === 'vector') {
          signals.vectorHits += 1;
          signals.bestVectorScore = Math.max(signals.bestVectorScore ?? -1, chunk.score);
        } else {
          signals.lexicalHits += 1;
          signals.bestLexicalScore = Math.max(signals.bestLexicalScore ?? 0, chunk.score);
        }
      } else {
        byId.set(dedupeKey, {
          ...chunk,
          fusedScore: increment,
          signals: {
            vectorHits: leg === 'vector' ? 1 : 0,
            lexicalHits: leg === 'lexical' ? 1 : 0,
            queryHits: 0,
            ...(leg === 'vector' ? { bestVectorScore: chunk.score } : { bestLexicalScore: chunk.score }),
          },
        });
      }
      const queries = seenQueryForKey.get(dedupeKey) ?? new Set<number>();
      queries.add(queryIndex);
      seenQueryForKey.set(dedupeKey, queries);
    });
  };

  const rankings = await Promise.all(queries.map(async (query) => {
    const [vector, lexical] = await Promise.all([
      embedQuery(query).then((embedding) =>
        knowledgeSearchRepo.searchVector(ctx, embedding, candidatesPerLeg, scope),
      ),
      fullTextLeg(ctx, query, candidatesPerLeg, scope),
    ]);
    return { vector, lexical };
  }));
  rankings.forEach((ranking, queryIndex) => {
    addRanking(ranking.vector, 'vector', queryIndex);
    addRanking(ranking.lexical, 'lexical', queryIndex);
  });
  for (const [key, passage] of byId) {
    if (passage.signals) passage.signals.queryHits = seenQueryForKey.get(key)?.size ?? 0;
  }

  return [...byId.values()].sort((a, b) => b.fusedScore - a.fusedScore);
}
