/**
 * Hybrid retrieval legs (vector kNN + Postgres full-text) for the agentic RAG loop. BOTH legs
 * reuse the exact tenant/audience/department predicates as the classic retriever — the reused
 * `departmentFilter` is the single chokepoint that makes reformulated queries structurally
 * unable to widen access (the RBAC-leakage suite asserts this on the built SQL).
 */
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { env } from '../config/env.js';
import { db, type DbOrTx } from '../db/client.js';
import { knowledgeChunks, knowledgeDocs, type KnowledgeDomain } from '../db/schema/index.js';
import { normalizeDepartments } from '../lib/department.js';
import { logger } from '../lib/logger.js';
import type { TenantContext } from '../types/tenantContext.js';
import { departmentFilter } from './knowledgeRepo.js';
import { toVectorLiteral } from './util.js';

/** Optional narrowing (never widening) of retrieval departments — e.g. an agent's RAG cap. */
export interface RetrievalScope {
  departments?: string[];
  /** Internal routing preference; never comes from model-generated filters. */
  domains?: KnowledgeDomain[];
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
  domain?: KnowledgeDomain;
  authorityClass?: string;
  sourceVersion?: string;
  verificationStatus?: string;
  lastVerifiedAt?: Date | null;
  expiresAt?: Date | null;
  contentHash?: string;
  sectionPath?: string | null;
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
    contentHash: knowledgeChunks.contentHash,
    sectionPath: knowledgeChunks.sectionPath,
    departmentAccess: knowledgeChunks.departmentAccess,
    domain: knowledgeDocs.domain,
    authorityClass: knowledgeDocs.authorityClass,
    sourceVersion: knowledgeDocs.sourceVersion,
    verificationStatus: knowledgeDocs.verificationStatus,
    lastVerifiedAt: knowledgeDocs.lastVerifiedAt,
    expiresAt: knowledgeDocs.expiresAt,
    stale: sql<boolean>`coalesce(${knowledgeDocs.expiresAt} < now(), false)
      OR coalesce(${knowledgeDocs.lastVerifiedAt} < now() - make_interval(days => ${env.STALE_DOC_DAYS}), false)`,
  };
}

function baseWhere(ctx: TenantContext, scope?: RetrievalScope) {
  return and(
    eq(knowledgeChunks.tenantId, ctx.tenantId),
    eq(knowledgeChunks.audience, ctx.audience),
    eq(knowledgeDocs.status, 'ready'),
    sql`${knowledgeDocs.verificationStatus} <> 'superseded'`,
    departmentFilter(ctx),
    scope?.domains?.length ? inArray(knowledgeDocs.domain, scope.domains) : undefined,
  );
}

function vectorQuery(
  runner: DbOrTx,
  ctx: TenantContext,
  embedding: number[],
  k: number,
  scope?: RetrievalScope,
) {
  const effective = resolveRetrievalContext(ctx, scope);
  const literal = toVectorLiteral(embedding);
  return runner
    .select({
      ...baseSelection(),
      score: sql<number>`1 - (${knowledgeChunks.embedding} <=> ${literal}::vector)`,
    })
    .from(knowledgeChunks)
    .innerJoin(knowledgeDocs, eq(knowledgeChunks.docId, knowledgeDocs.id))
    .where(baseWhere(effective, scope))
    .orderBy(sql`${knowledgeChunks.embedding} <=> ${literal}::vector`)
    .limit(k);
}

async function exactVectorSearch(
  ctx: TenantContext,
  embedding: number[],
  k: number,
  scope?: RetrievalScope,
): Promise<HybridChunk[]> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local enable_indexscan = off`);
    return vectorQuery(tx, ctx, embedding, k, scope);
  });
}

async function annVectorSearch(
  ctx: TenantContext,
  embedding: number[],
  k: number,
  scope?: RetrievalScope,
): Promise<HybridChunk[]> {
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`set local hnsw.iterative_scan = 'strict_order'`);
      await tx.execute(sql`select set_config('hnsw.ef_search', ${String(env.RAG_HNSW_EF_SEARCH)}, true)`);
      return vectorQuery(tx, ctx, embedding, k, scope);
    });
  } catch (err) {
    logger.warn({ err }, 'pgvector iterative scan unavailable; using standard ANN query');
    return vectorQuery(db, ctx, embedding, k, scope);
  }
}

async function countEligible(ctx: TenantContext, scope?: RetrievalScope): Promise<number> {
  const effective = resolveRetrievalContext(ctx, scope);
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(knowledgeChunks)
    .innerJoin(knowledgeDocs, eq(knowledgeChunks.docId, knowledgeDocs.id))
    .where(baseWhere(effective, scope));
  return rows[0]?.count ?? 0;
}

export const knowledgeSearchRepo = {
  /** Vector leg (exposed as a builder so tests can assert the WHERE offline via .toSQL()). */
  buildVectorQuery(ctx: TenantContext, embedding: number[], k: number, scope?: RetrievalScope) {
    return vectorQuery(db, ctx, embedding, k, scope);
  },

  /** Full-text leg over the generated content_tsv column (websearch syntax, ts_rank_cd order). */
  buildFullTextQuery(ctx: TenantContext, query: string, k: number, scope?: RetrievalScope) {
    const effective = resolveRetrievalContext(ctx, scope);
    const tsQuery = sql`websearch_to_tsquery('simple', ${query})`;
    return db
      .select({
        ...baseSelection(),
        score: sql<number>`ts_rank_cd(${knowledgeChunks.contentTsvSimple}, ${tsQuery})`,
      })
      .from(knowledgeChunks)
      .innerJoin(knowledgeDocs, eq(knowledgeChunks.docId, knowledgeDocs.id))
      .where(
        and(
          baseWhere(effective, scope),
          sql`${knowledgeChunks.contentTsvSimple} @@ ${tsQuery}`,
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
    const strategy = env.RAG_RETRIEVAL_STRATEGY;
    if (strategy === 'exact') return exactVectorSearch(ctx, embedding, k, scope);
    if (strategy === 'ann') {
      const eligible = await countEligible(ctx, scope);
      return eligible >= env.RAG_ANN_MIN_ELIGIBLE_CHUNKS
        ? annVectorSearch(ctx, embedding, k, scope)
        : exactVectorSearch(ctx, embedding, k, scope);
    }
    const [exact, ann] = await Promise.all([
      exactVectorSearch(ctx, embedding, k, scope),
      annVectorSearch(ctx, embedding, k, scope),
    ]);
    const exactIds = new Set(exact.map((row) => row.id));
    const overlap = ann.filter((row) => exactIds.has(row.id)).length / Math.max(1, exact.length);
    logger.info({ overlap, k, tenantId: ctx.tenantId }, 'RAG exact-vs-ANN shadow recall');
    return exact;
  },

  countEligibleChunks: countEligible,

  async searchFullText(
    ctx: TenantContext,
    query: string,
    k: number,
    scope?: RetrievalScope,
  ): Promise<HybridChunk[]> {
    return this.buildFullTextQuery(ctx, query, k, scope);
  },
};
