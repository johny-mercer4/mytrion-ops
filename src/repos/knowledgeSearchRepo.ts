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

/** Terms too generic to be worth OR-ing; `english` drops most stop words, these are the leftovers. */
const LEXICAL_NOISE = new Set(['what', 'which', 'where', 'when', 'how', 'why', 'who', 'does', 'do']);
/** Enough terms to describe a question; more only broadens the candidate set without adding signal. */
const MAX_LEXICAL_TERMS = 12;

/**
 * Rewrite free text as a websearch OR expression: `activate or card or sales`. Keeps intra-word
 * hyphens so service codes ("C-16") survive as one term. Returns '' when nothing useful remains,
 * which yields an empty tsquery and therefore no rows — the correct answer for a term-free question.
 */
export function orOfTerms(query: string): string {
  const terms = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}-]+/u)
    .map((term) => term.replace(/^-+|-+$/g, ''))
    .filter((term) => term.length > 1 && !LEXICAL_NOISE.has(term));
  return [...new Set(terms)].slice(0, MAX_LEXICAL_TERMS).join(' or ');
}

export const knowledgeSearchRepo = {
  /** Vector leg (exposed as a builder so tests can assert the WHERE offline via .toSQL()). */
  buildVectorQuery(ctx: TenantContext, embedding: number[], k: number, scope?: RetrievalScope) {
    return vectorQuery(db, ctx, embedding, k, scope);
  },

  /**
   * Full-text leg. OR-of-terms over the english `content_tsv`, ranked by `ts_rank_cd`.
   *
   * This used to be `websearch_to_tsquery('simple', <the whole question>)`, which returned **zero
   * rows for every natural-language question**: websearch ANDs its terms, and the `simple` config
   * removes no stop words, so a chunk had to contain "how", "do", "i", "a" and "in" as literal
   * lexemes. Measured — 'activate card' matched 5 chunks, "How do I activate a card in Sales
   * Mytrion?" matched 0.
   *
   * A silently empty lexical leg is expensive far beyond lost recall: `assessEvidence` needs
   * vector/lexical `agreement` to certify evidence as `sufficient`, so without it every question fell
   * through to the semantic CRAG judge and then a second corrective hop — two extra model calls per
   * turn to re-learn what a working keyword match already knew.
   *
   * OR semantics restore recall (a question shares only some of its words with the answer) while
   * `ts_rank_cd` keeps precision: it scores by how many distinct terms matched and how close they
   * are, so the on-topic document still ranks first and RRF fuses from there. `english` is chosen
   * over `simple` because it stems and drops stop words; the cost is slightly weaker bare-code
   * matching ("C-16" alone), which the vector leg and `ts_rank_cd` term-density both cover.
   *
   * `websearch_to_tsquery` (rather than `to_tsquery`) keeps this injection-safe and syntax-error
   * proof: unbalanced quotes or stray operators in user text degrade instead of throwing.
   */
  buildFullTextQuery(ctx: TenantContext, query: string, k: number, scope?: RetrievalScope) {
    const effective = resolveRetrievalContext(ctx, scope);
    const tsQuery = sql`websearch_to_tsquery('english', ${orOfTerms(query)})`;
    return db
      .select({
        ...baseSelection(),
        score: sql<number>`ts_rank_cd(${knowledgeChunks.contentTsv}, ${tsQuery})`,
      })
      .from(knowledgeChunks)
      .innerJoin(knowledgeDocs, eq(knowledgeChunks.docId, knowledgeDocs.id))
      .where(
        and(
          baseWhere(effective, scope),
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
