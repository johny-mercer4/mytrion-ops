import { and, desc, eq, sql } from 'drizzle-orm';
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

export const knowledgeRepo = {
  async createDoc(
    ctx: TenantContext,
    input: { title: string; source?: string; mimeType?: string; checksum?: string },
  ): Promise<KnowledgeDoc> {
    const values: NewKnowledgeDoc = {
      tenantId: ctx.tenantId,
      audience: ctx.audience,
      title: input.title,
    };
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
    page?: { limit?: number; offset?: number },
  ): Promise<KnowledgeDoc[]> {
    const { limit, offset } = normalizePagination(page);
    return db
      .select()
      .from(knowledgeDocs)
      .where(and(eq(knowledgeDocs.tenantId, ctx.tenantId), eq(knowledgeDocs.audience, ctx.audience)))
      .orderBy(desc(knowledgeDocs.createdAt))
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
  async replaceChunks(ctx: TenantContext, docId: string, chunks: NewChunkInput[]): Promise<void> {
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
