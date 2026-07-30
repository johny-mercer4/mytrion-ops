import { logger } from '../../lib/logger.js';
import {
  supportBotKnowledgeRepo,
  type SupportBotKnowledgeHit,
  type SupportBotKnowledgeScope,
  type SupportBotKnowledgeUpsert,
} from '../../repos/supportBotKnowledgeRepo.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { embedQuery } from '../knowledge/embedder.js';

const CANDIDATES_PER_LEG = 8;
const RRF_K = 60;
const MIN_VECTOR_SCORE = 0.38;

export interface SupportBotKnowledgeResult {
  id: string;
  slug: string;
  title: string;
  content: string;
  translations: Record<string, string>;
  serviceId: string | null;
  knowledgeType: 'static' | 'workflow' | 'tool_pointer';
  riskClass: 'read' | 'write' | 'sensitive';
  source: string | null;
  version: number;
  score: number;
}

interface RankedArticle {
  hit: SupportBotKnowledgeHit;
  fusedScore: number;
}

/**
 * Reciprocal-rank fusion with a small carrier-overlay preference. Deduplication by slug makes a
 * carrier article replace its tenant-global base article instead of leaking two conflicting facts.
 */
export function fuseSupportBotKnowledgeHits(
  carrierId: string,
  vectorHits: SupportBotKnowledgeHit[],
  textHits: SupportBotKnowledgeHit[],
  limit: number,
): SupportBotKnowledgeResult[] {
  const ranked = new Map<string, RankedArticle>();
  const addLeg = (hits: SupportBotKnowledgeHit[], vector: boolean): void => {
    hits.forEach((hit, rank) => {
      if (vector && hit.score < MIN_VECTOR_SCORE) return;
      const current = ranked.get(hit.id);
      const increment = 1 / (RRF_K + rank + 1);
      if (current) current.fusedScore += increment;
      else ranked.set(hit.id, { hit, fusedScore: increment });
    });
  };
  addLeg(vectorHits, true);
  addLeg(textHits, false);

  const sorted = [...ranked.values()]
    .map((item) => ({
      ...item,
      fusedScore:
        item.fusedScore + (item.hit.carrierId === carrierId ? 0.002 : 0),
    }))
    .sort((left, right) => right.fusedScore - left.fusedScore);

  const seenSlugs = new Set<string>();
  const results: SupportBotKnowledgeResult[] = [];
  for (const item of sorted) {
    if (seenSlugs.has(item.hit.slug)) continue;
    seenSlugs.add(item.hit.slug);
    results.push({
      id: item.hit.id,
      slug: item.hit.slug,
      title: item.hit.title,
      content: item.hit.content,
      translations: item.hit.translations,
      serviceId: item.hit.serviceId,
      knowledgeType: item.hit.knowledgeType,
      riskClass: item.hit.riskClass,
      source: item.hit.source,
      version: item.hit.version,
      score: item.fusedScore,
    });
    if (results.length >= limit) break;
  }
  return results;
}

export async function searchSupportBotKnowledge(
  ctx: TenantContext,
  scope: SupportBotKnowledgeScope,
  rawQuery: string,
  requestedLimit = 3,
): Promise<SupportBotKnowledgeResult[]> {
  const query = rawQuery.replace(/\s+/gu, ' ').trim().slice(0, 400);
  if (query.length < 2) return [];
  const limit = Math.min(Math.max(1, requestedLimit), 5);

  const textPromise = supportBotKnowledgeRepo
    .searchFullText(ctx, scope, query, CANDIDATES_PER_LEG)
    .catch((error: unknown) => {
      logger.warn({ error }, 'support KB full-text leg failed');
      return [];
    });
  const vectorPromise = embedQuery(query)
    .then((embedding) =>
      supportBotKnowledgeRepo.searchVector(
        ctx,
        scope,
        embedding,
        CANDIDATES_PER_LEG,
      ),
    )
    .catch((error: unknown) => {
      logger.warn({ error }, 'support KB vector leg failed');
      return [];
    });

  const [textHits, vectorHits] = await Promise.all([
    textPromise,
    vectorPromise,
  ]);
  return fuseSupportBotKnowledgeHits(
    scope.carrierId,
    vectorHits,
    textHits,
    limit,
  );
}

/** Embed only approved article text; raw historical chats never enter this path. */
export async function upsertSupportBotKnowledge(
  ctx: TenantContext,
  input: SupportBotKnowledgeUpsert,
) {
  const embedding = await embedQuery(
    `${input.title}\n${input.content}\n${input.keywords ?? ''}`.slice(0, 8_000),
  );
  return supportBotKnowledgeRepo.upsert(ctx, { ...input, embedding });
}
