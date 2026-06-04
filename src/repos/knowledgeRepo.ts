import { and, desc, eq, inArray, isNull, or, type SQL, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  knowledgeChunks,
  knowledgeDocs,
  type KnowledgeChunk,
  type KnowledgeDoc,
  type NewKnowledgeChunk,
  type NewKnowledgeDoc,
} from '../db/schema/index.js';
import type { TenantContext } from '../types/tenantContext.js';
import { firstOrThrow, firstOrUndefined, normalizePagination, toVectorLiteral } from './util.js';

export interface NewChunkInput {
  chunkIndex: number;
  content: string;
  embedding: number[];
  tokenCount?: number;
  metadata?: Record<string, unknown>;
}

export interface ChunkSearchResult {
  id: string;
  docId: string;
  chunkIndex: number;
  content: string;
  /** Cosine similarity in [0, 1]; higher is more relevant. */
  score: number;
}

export interface UpdateDocPatch {
  status?: KnowledgeDoc['status'];
  chunkCount?: number;
  error?: string | null;
  title?: string;
}

/**
 * RBAC department filter for retrieval. Managers (allDepartmentAccess) get no restriction.
 * Otherwise: always include global (NULL) chunks, plus any in the caller's departments.
 * Returns undefined when unrestricted so `and(...)` simply drops it.
 */
function departmentFilter(ctx: TenantContext): SQL | undefined {
  if (ctx.allDepartmentAccess) return undefined;
  const col = knowledgeChunks.departmentAccess;
  if (ctx.departments.length === 0) return isNull(col);
  return or(isNull(col), inArray(col, ctx.departments));
}

export const knowledgeRepo = {
  async createDoc(
    ctx: TenantContext,
    input: {
      title: string;
      source?: string;
      mimeType?: string;
      checksum?: string;
      departmentAccess?: string | null;
    },
  ): Promise<KnowledgeDoc> {
    const values: NewKnowledgeDoc = {
      tenantId: ctx.tenantId,
      audience: ctx.audience,
      title: input.title,
    };
    if (input.departmentAccess !== undefined) values.departmentAccess = input.departmentAccess;
    if (input.source !== undefined) values.source = input.source;
    if (input.mimeType !== undefined) values.mimeType = input.mimeType;
    if (input.checksum !== undefined) values.checksum = input.checksum;
    const rows = await db.insert(knowledgeDocs).values(values).returning();
    return firstOrThrow(rows, 'Failed to create knowledge doc');
  },

  async findDoc(ctx: TenantContext, docId: string): Promise<KnowledgeDoc | undefined> {
    const rows = await db
      .select()
      .from(knowledgeDocs)
      .where(and(eq(knowledgeDocs.id, docId), eq(knowledgeDocs.tenantId, ctx.tenantId)))
      .limit(1);
    return firstOrUndefined(rows);
  },

  async findDocByChecksum(ctx: TenantContext, checksum: string): Promise<KnowledgeDoc | undefined> {
    const rows = await db
      .select()
      .from(knowledgeDocs)
      .where(and(eq(knowledgeDocs.tenantId, ctx.tenantId), eq(knowledgeDocs.checksum, checksum)))
      .limit(1);
    return firstOrUndefined(rows);
  },

  async listDocs(
    ctx: TenantContext,
    page?: { limit?: number; offset?: number; department?: string },
  ): Promise<KnowledgeDoc[]> {
    const { limit, offset } = normalizePagination(page);
    return db
      .select()
      .from(knowledgeDocs)
      .where(
        and(
          eq(knowledgeDocs.tenantId, ctx.tenantId),
          eq(knowledgeDocs.audience, ctx.audience),
          page?.department ? eq(knowledgeDocs.departmentAccess, page.department) : undefined,
        ),
      )
      .orderBy(desc(knowledgeDocs.createdAt))
      .limit(limit)
      .offset(offset);
  },

  async countDocs(ctx: TenantContext): Promise<number> {
    const rows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(knowledgeDocs)
      .where(eq(knowledgeDocs.tenantId, ctx.tenantId));
    return firstOrUndefined(rows)?.count ?? 0;
  },

  /** List a doc's chunks for inspection. Excludes the raw 1536-float embedding (too large). */
  async listChunksByDoc(
    ctx: TenantContext,
    docId: string,
    page?: { limit?: number; offset?: number },
  ): Promise<
    Array<{
      id: string;
      chunkIndex: number;
      content: string;
      tokenCount: number | null;
      departmentAccess: string | null;
      hasEmbedding: boolean;
    }>
  > {
    const { limit, offset } = normalizePagination(page);
    return db
      .select({
        id: knowledgeChunks.id,
        chunkIndex: knowledgeChunks.chunkIndex,
        content: knowledgeChunks.content,
        tokenCount: knowledgeChunks.tokenCount,
        departmentAccess: knowledgeChunks.departmentAccess,
        hasEmbedding: sql<boolean>`(${knowledgeChunks.embedding} is not null)`,
      })
      .from(knowledgeChunks)
      .where(and(eq(knowledgeChunks.tenantId, ctx.tenantId), eq(knowledgeChunks.docId, docId)))
      .orderBy(knowledgeChunks.chunkIndex)
      .limit(limit)
      .offset(offset);
  },

  async updateDoc(
    ctx: TenantContext,
    docId: string,
    patch: UpdateDocPatch,
  ): Promise<KnowledgeDoc | undefined> {
    const set: Partial<NewKnowledgeDoc> & { updatedAt: Date } = { updatedAt: new Date() };
    if (patch.status !== undefined) set.status = patch.status;
    if (patch.chunkCount !== undefined) set.chunkCount = patch.chunkCount;
    if (patch.error !== undefined) set.error = patch.error;
    if (patch.title !== undefined) set.title = patch.title;
    const rows = await db
      .update(knowledgeDocs)
      .set(set)
      .where(and(eq(knowledgeDocs.id, docId), eq(knowledgeDocs.tenantId, ctx.tenantId)))
      .returning();
    return firstOrUndefined(rows);
  },

  /** Atomically replace all chunks for a doc (idempotent re-ingest). */
  async replaceChunks(
    ctx: TenantContext,
    docId: string,
    chunks: NewChunkInput[],
    departmentAccess: string | null = null,
  ): Promise<void> {
    await db.transaction(async (tx) => {
      await tx
        .delete(knowledgeChunks)
        .where(and(eq(knowledgeChunks.tenantId, ctx.tenantId), eq(knowledgeChunks.docId, docId)));
      if (chunks.length === 0) return;
      const rows: NewKnowledgeChunk[] = chunks.map((c) => {
        const row: NewKnowledgeChunk = {
          tenantId: ctx.tenantId,
          audience: ctx.audience,
          docId,
          departmentAccess,
          chunkIndex: c.chunkIndex,
          content: c.content,
          embedding: c.embedding,
        };
        if (c.tokenCount !== undefined) row.tokenCount = c.tokenCount;
        if (c.metadata !== undefined) row.metadata = c.metadata;
        return row;
      });
      await tx.insert(knowledgeChunks).values(rows);
    });
  },

  /**
   * Build (but do not execute) the tenant- and audience-scoped kNN query. Exposed
   * so the RBAC isolation test can assert the WHERE clause via `.toSQL()` without a DB.
   */
  buildSearchQuery(ctx: TenantContext, embedding: number[], k: number) {
    const literal = toVectorLiteral(embedding);
    return db
      .select({
        id: knowledgeChunks.id,
        docId: knowledgeChunks.docId,
        chunkIndex: knowledgeChunks.chunkIndex,
        content: knowledgeChunks.content,
        score: sql<number>`1 - (${knowledgeChunks.embedding} <=> ${literal}::vector)`,
      })
      .from(knowledgeChunks)
      .where(
        and(
          eq(knowledgeChunks.tenantId, ctx.tenantId),
          eq(knowledgeChunks.audience, ctx.audience),
          departmentFilter(ctx),
        ),
      )
      .orderBy(sql`${knowledgeChunks.embedding} <=> ${literal}::vector`)
      .limit(k);
  },

  async searchChunks(
    ctx: TenantContext,
    embedding: number[],
    k: number,
  ): Promise<ChunkSearchResult[]> {
    return this.buildSearchQuery(ctx, embedding, k);
  },

  async countChunks(ctx: TenantContext): Promise<number> {
    const rows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(knowledgeChunks)
      .where(eq(knowledgeChunks.tenantId, ctx.tenantId));
    return firstOrUndefined(rows)?.count ?? 0;
  },
};

export type { KnowledgeChunk };
