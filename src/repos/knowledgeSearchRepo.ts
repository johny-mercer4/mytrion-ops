/**
 * Hybrid retrieval legs (vector kNN + Postgres full-text) for the agentic RAG loop. BOTH legs
 * reuse the exact tenant/audience/department predicates as the classic retriever — the reused
 * `departmentFilter` is the single chokepoint that makes reformulated queries structurally
 * unable to widen access (the RBAC-leakage suite asserts this on the built SQL).
 */
import { and, desc, eq, sql } from 'drizzle-orm';
import { env } from '../config/env.js';
import { db } from '../db/client.js';
import { knowledgeChunks, knowledgeDocs } from '../db/schema/index.js';
import { normalizeDepartments } from '../lib/department.js';
import type { TenantContext } from '../types/tenantContext.js';
import { departmentFilter } from './knowledgeRepo.js';
import { toVectorLiteral } from './util.js';

/** Optional narrowing (never widening) of retrieval departments — e.g. an agent's RAG cap. */
export interface RetrievalScope {
  departments?: string[];
}

export interface HybridChunk {
  id: string;
  docId: string;
  docTitle: string | null;
  chunkIndex: number;
  content: string;
  departmentAccess: string | null;
  /** Doc past expiry or unverified beyond STALE_DOC_DAYS — demoted in fusion + flagged in citations. */
  stale: boolean;
  /** Leg-specific relevance (cosine similarity / ts_rank_cd) — used for ranking only. */
  score: number;
}

function intersect(a: string[], b: string[]): string[] {
  const set = new Set(b);
  return a.filter((v) => set.has(v));
}

/**
 * Apply a scope CAP to a context. Intersection-only: a scope narrows even admins (their
 * unrestricted access becomes exactly the cap list) and can never add departments.
 */
export function resolveRetrievalContext(ctx: TenantContext, scope?: RetrievalScope): TenantContext {
  const cap = normalizeDepartments(scope?.departments ?? []);
  if (cap.length === 0) return ctx;
  if (ctx.allDepartmentAccess) {
    return { ...ctx, allDepartmentAccess: false, departments: cap };
  }
  return { ...ctx, departments: intersect(normalizeDepartments(ctx.departments), cap) };
}

function baseSelection() {
  return {
    id: knowledgeChunks.id,
    docId: knowledgeChunks.docId,
    docTitle: knowledgeDocs.title,
    chunkIndex: knowledgeChunks.chunkIndex,
    content: knowledgeChunks.content,
    departmentAccess: knowledgeChunks.departmentAccess,
    stale: sql<boolean>`coalesce(${knowledgeDocs.expiresAt} < now(), false)
      OR coalesce(${knowledgeDocs.lastVerifiedAt} < now() - make_interval(days => ${env.STALE_DOC_DAYS}), false)`,
  };
}

export const knowledgeSearchRepo = {
  /** Vector leg (exposed as a builder so tests can assert the WHERE offline via .toSQL()). */
  buildVectorQuery(ctx: TenantContext, embedding: number[], k: number, scope?: RetrievalScope) {
    const effective = resolveRetrievalContext(ctx, scope);
    const literal = toVectorLiteral(embedding);
    return db
      .select({
        ...baseSelection(),
        score: sql<number>`1 - (${knowledgeChunks.embedding} <=> ${literal}::vector)`,
      })
      .from(knowledgeChunks)
      .innerJoin(knowledgeDocs, eq(knowledgeChunks.docId, knowledgeDocs.id))
      .where(
        and(
          eq(knowledgeChunks.tenantId, effective.tenantId),
          eq(knowledgeChunks.audience, effective.audience),
          departmentFilter(effective),
        ),
      )
      .orderBy(sql`${knowledgeChunks.embedding} <=> ${literal}::vector`)
      .limit(k);
  },

  /** Full-text leg over the generated content_tsv column (websearch syntax, ts_rank_cd order). */
  buildFullTextQuery(ctx: TenantContext, query: string, k: number, scope?: RetrievalScope) {
    const effective = resolveRetrievalContext(ctx, scope);
    const tsQuery = sql`websearch_to_tsquery('english', ${query})`;
    return db
      .select({
        ...baseSelection(),
        score: sql<number>`ts_rank_cd(${knowledgeChunks.contentTsv}, ${tsQuery})`,
      })
      .from(knowledgeChunks)
      .innerJoin(knowledgeDocs, eq(knowledgeChunks.docId, knowledgeDocs.id))
      .where(
        and(
          eq(knowledgeChunks.tenantId, effective.tenantId),
          eq(knowledgeChunks.audience, effective.audience),
          departmentFilter(effective),
          sql`${knowledgeChunks.contentTsv} @@ ${tsQuery}`,
        ),
      )
      .orderBy((aliases) => desc(aliases.score))
      .limit(k);
  },

  async searchVector(
    ctx: TenantContext,
    embedding: number[],
    k: number,
    scope?: RetrievalScope,
  ): Promise<HybridChunk[]> {
    return this.buildVectorQuery(ctx, embedding, k, scope);
  },

  async searchFullText(
    ctx: TenantContext,
    query: string,
    k: number,
    scope?: RetrievalScope,
  ): Promise<HybridChunk[]> {
    return this.buildFullTextQuery(ctx, query, k, scope);
  },
};
