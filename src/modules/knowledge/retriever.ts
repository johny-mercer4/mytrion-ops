import { DEFAULT_RETRIEVAL_K, MAX_RETRIEVAL_K } from '../../config/constants.js';
import { env } from '../../config/env.js';
import { knowledgeRepo, type ChunkSearchResult } from '../../repos/knowledgeRepo.js';
import { knowledgeSearchRepo } from '../../repos/knowledgeSearchRepo.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { embedQuery } from './embedder.js';

export type { ChunkSearchResult };

/**
 * Embed a query and run a tenant- and audience-scoped kNN search over pgvector.
 * Isolation is enforced in knowledgeRepo (WHERE tenant_id = ctx.tenantId AND audience).
 */
export async function retrieve(
  ctx: TenantContext,
  query: string,
  k: number = DEFAULT_RETRIEVAL_K,
): Promise<ChunkSearchResult[]> {
  const topK = Math.min(Math.max(Math.trunc(k), 1), MAX_RETRIEVAL_K);
  const embedding = await embedQuery(query);
  if (!env.FF_RAG_V2_RETRIEVAL) return knowledgeRepo.searchChunks(ctx, embedding, topK);
  const rows = await knowledgeSearchRepo.searchVector(ctx, embedding, topK);
  return rows.map((row) => ({
    id: row.id,
    docId: row.docId,
    chunkIndex: row.chunkIndex,
    content: row.content,
    score: row.score,
  }));
}
