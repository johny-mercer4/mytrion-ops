import { and, desc, eq, inArray, isNull, or, type SQL, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  knowledgeChunks,
  knowledgeDocs,
  type KnowledgeChunk,
  type KnowledgeDoc,
  type NewKnowledgeChunk,
  type NewKnowledgeDoc,
  type KnowledgeAuthorityClass,
  type KnowledgeDomain,
  type KnowledgeVerificationStatus,
} from '../db/schema/index.js';
import type { TenantContext } from '../types/tenantContext.js';
import { firstOrUndefined, normalizePagination, toVectorLiteral } from './util.js';

export interface NewChunkInput {
  chunkIndex: number;
  content: string;
  retrievalText: string;
  contentHash: string;
  sectionPath?: string;
  embeddingModel: string;
  embeddingDimensions: number;
  sourceVersion: string;
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
  departmentAccess?: string | null;
  verificationStatus?: KnowledgeVerificationStatus;
  lastVerifiedAt?: Date | null;
}

export interface CreateKnowledgeDocInput {
  title: string;
  source?: string;
  mimeType?: string;
  checksum?: string;
  departmentAccess?: string | null;
  origin?: string;
  domain?: KnowledgeDomain;
  language?: string;
  authorityClass?: KnowledgeAuthorityClass;
  owner?: string;
  sourceVersion?: string;
  sourceCommit?: string;
  supersedesDocId?: string;
  effectiveAt?: Date;
  expiresAt?: Date;
  metadata?: Record<string, unknown>;
}

export interface CreateKnowledgeDocResult {
  doc: KnowledgeDoc;
  inserted: boolean;
}

/**
 * RBAC department filter for retrieval. Managers (allDepartmentAccess) get no restriction.
 * Otherwise: always include global (NULL) chunks, plus any in the caller's departments.
 * Returns undefined when unrestricted so `and(...)` simply drops it.
 * Exported: the SINGLE chokepoint every retrieval leg (vector, full-text, memory) must reuse.
 */
export function departmentFilter(ctx: TenantContext): SQL | undefined {
  if (ctx.allDepartmentAccess) return undefined;
  const col = knowledgeChunks.departmentAccess;
  if (ctx.departments.length === 0) return isNull(col);
  return or(isNull(col), inArray(col, ctx.departments));
}

export const knowledgeRepo = {
  /** Freshness attest: reset the doc's last_verified_at (admin action via /knowledge/docs/:id/verify). */
  async markVerified(ctx: TenantContext, id: string): Promise<boolean> {
    const rows = await db
      .update(knowledgeDocs)
      .set({ verificationStatus: 'verified', lastVerifiedAt: sql`now()`, updatedAt: sql`now()` })
      .where(and(eq(knowledgeDocs.tenantId, ctx.tenantId), eq(knowledgeDocs.id, id)))
      .returning({ id: knowledgeDocs.id });
    return rows.length > 0;
  },

  async createDoc(ctx: TenantContext, input: CreateKnowledgeDocInput): Promise<CreateKnowledgeDocResult> {
    const values: NewKnowledgeDoc = {
      tenantId: ctx.tenantId,
      audience: ctx.audience,
      title: input.title,
    };
    if (input.departmentAccess !== undefined) values.departmentAccess = input.departmentAccess;
    if (input.source !== undefined) values.source = input.source;
    if (input.mimeType !== undefined) values.mimeType = input.mimeType;
    if (input.checksum !== undefined) values.checksum = input.checksum;
    if (input.origin !== undefined) values.origin = input.origin;
    if (input.domain !== undefined) values.domain = input.domain;
    if (input.language !== undefined) values.language = input.language;
    if (input.authorityClass !== undefined) values.authorityClass = input.authorityClass;
    if (input.owner !== undefined) values.owner = input.owner;
    if (input.sourceVersion !== undefined) values.sourceVersion = input.sourceVersion;
    if (input.sourceCommit !== undefined) values.sourceCommit = input.sourceCommit;
    if (input.supersedesDocId !== undefined) values.supersedesDocId = input.supersedesDocId;
    if (input.effectiveAt !== undefined) values.effectiveAt = input.effectiveAt;
    if (input.expiresAt !== undefined) values.expiresAt = input.expiresAt;
    if (input.metadata !== undefined) values.metadata = input.metadata;
    const rows = await db.insert(knowledgeDocs).values(values).onConflictDoNothing().returning();
    const inserted = firstOrUndefined(rows);
    if (inserted) return { doc: inserted, inserted: true };
    if (input.checksum) {
      const existing = await this.findDocByChecksum(ctx, input.checksum);
      if (existing) return { doc: existing, inserted: false };
    }
    throw new Error('Failed to create or resolve knowledge doc');
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
      .where(and(
        eq(knowledgeDocs.tenantId, ctx.tenantId),
        eq(knowledgeDocs.audience, ctx.audience),
        eq(knowledgeDocs.checksum, checksum),
      ))
      .limit(1);
    return firstOrUndefined(rows);
  },

  async findLatestBySource(
    ctx: TenantContext,
    source: string,
    domain: KnowledgeDomain,
  ): Promise<KnowledgeDoc | undefined> {
    const rows = await db
      .select()
      .from(knowledgeDocs)
      .where(and(
        eq(knowledgeDocs.tenantId, ctx.tenantId),
        eq(knowledgeDocs.audience, ctx.audience),
        eq(knowledgeDocs.source, source),
        eq(knowledgeDocs.domain, domain),
        sql`${knowledgeDocs.verificationStatus} <> 'superseded'`,
      ))
      .orderBy(desc(knowledgeDocs.updatedAt))
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
    if (patch.departmentAccess !== undefined) set.departmentAccess = patch.departmentAccess;
    if (patch.verificationStatus !== undefined) set.verificationStatus = patch.verificationStatus;
    if (patch.lastVerifiedAt !== undefined) set.lastVerifiedAt = patch.lastVerifiedAt;
    const rows = await db
      .update(knowledgeDocs)
      .set(set)
      .where(and(eq(knowledgeDocs.id, docId), eq(knowledgeDocs.tenantId, ctx.tenantId)))
      .returning();
    return firstOrUndefined(rows);
  },

  /** Update a doc's department on both the doc and all its chunks (cheap re-tag, no re-embed). */
  async setDepartment(
    ctx: TenantContext,
    docId: string,
    department: string | null,
  ): Promise<void> {
    await db.transaction(async (tx) => {
      await tx
        .update(knowledgeDocs)
        .set({ departmentAccess: department, updatedAt: new Date() })
        .where(and(eq(knowledgeDocs.id, docId), eq(knowledgeDocs.tenantId, ctx.tenantId)));
      await tx
        .update(knowledgeChunks)
        .set({ departmentAccess: department })
        .where(and(eq(knowledgeChunks.tenantId, ctx.tenantId), eq(knowledgeChunks.docId, docId)));
    });
  },

  /**
   * Hard-delete a doc and all its chunks (cascade). Returns the deleted doc summary, or null
   * if no such doc. Because the row (incl. its checksum) is removed, re-uploading the same
   * file re-ingests fresh (no checksum match → not "skipped").
   */
  async deleteDoc(
    ctx: TenantContext,
    docId: string,
  ): Promise<{ id: string; title: string; chunkCount: number } | null> {
    return db.transaction(async (tx) => {
      await tx
        .delete(knowledgeChunks)
        .where(and(eq(knowledgeChunks.tenantId, ctx.tenantId), eq(knowledgeChunks.docId, docId)));
      const rows = await tx
        .delete(knowledgeDocs)
        .where(and(eq(knowledgeDocs.id, docId), eq(knowledgeDocs.tenantId, ctx.tenantId)))
        .returning({
          id: knowledgeDocs.id,
          title: knowledgeDocs.title,
          chunkCount: knowledgeDocs.chunkCount,
        });
      return rows[0] ?? null;
    });
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
          retrievalText: c.retrievalText,
          contentHash: c.contentHash,
          embeddingModel: c.embeddingModel,
          embeddingDimensions: c.embeddingDimensions,
          sourceVersion: c.sourceVersion,
          embedding: c.embedding,
        };
        if (c.sectionPath !== undefined) row.sectionPath = c.sectionPath;
        if (c.tokenCount !== undefined) row.tokenCount = c.tokenCount;
        if (c.metadata !== undefined) row.metadata = c.metadata;
        return row;
      });
      await tx.insert(knowledgeChunks).values(rows);
    });
  },

  /** Commit chunks + ready state + optional supersession in one transaction. */
  async commitIngestion(
    ctx: TenantContext,
    docId: string,
    chunks: NewChunkInput[],
    departmentAccess: string | null,
    supersedesDocId?: string,
  ): Promise<void> {
    await db.transaction(async (tx) => {
      const owned = await tx
        .select({ id: knowledgeDocs.id })
        .from(knowledgeDocs)
        .where(and(eq(knowledgeDocs.id, docId), eq(knowledgeDocs.tenantId, ctx.tenantId)))
        .limit(1);
      if (!owned[0]) throw new Error('Knowledge doc not found for ingestion commit');
      await tx.delete(knowledgeChunks).where(and(
        eq(knowledgeChunks.tenantId, ctx.tenantId),
        eq(knowledgeChunks.docId, docId),
      ));
      const rows: NewKnowledgeChunk[] = chunks.map((chunk) => ({
        tenantId: ctx.tenantId,
        audience: ctx.audience,
        docId,
        departmentAccess,
        chunkIndex: chunk.chunkIndex,
        content: chunk.content,
        retrievalText: chunk.retrievalText,
        contentHash: chunk.contentHash,
        embeddingModel: chunk.embeddingModel,
        embeddingDimensions: chunk.embeddingDimensions,
        sourceVersion: chunk.sourceVersion,
        embedding: chunk.embedding,
        ...(chunk.sectionPath !== undefined ? { sectionPath: chunk.sectionPath } : {}),
        ...(chunk.tokenCount !== undefined ? { tokenCount: chunk.tokenCount } : {}),
        ...(chunk.metadata !== undefined ? { metadata: chunk.metadata } : {}),
      }));
      if (rows.length > 0) await tx.insert(knowledgeChunks).values(rows);
      await tx
        .update(knowledgeDocs)
        .set({
          status: 'ready',
          chunkCount: rows.length,
          departmentAccess,
          error: null,
          updatedAt: new Date(),
        })
        .where(and(eq(knowledgeDocs.id, docId), eq(knowledgeDocs.tenantId, ctx.tenantId)));
      if (supersedesDocId && supersedesDocId !== docId) {
        await tx
          .update(knowledgeDocs)
          .set({ verificationStatus: 'superseded', updatedAt: new Date() })
          .where(and(
            eq(knowledgeDocs.id, supersedesDocId),
            eq(knowledgeDocs.tenantId, ctx.tenantId),
            eq(knowledgeDocs.audience, ctx.audience),
          ));
      }
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
      .innerJoin(knowledgeDocs, eq(knowledgeChunks.docId, knowledgeDocs.id))
      .where(
        and(
          eq(knowledgeChunks.tenantId, ctx.tenantId),
          eq(knowledgeChunks.audience, ctx.audience),
          eq(knowledgeDocs.status, 'ready'),
          sql`${knowledgeDocs.verificationStatus} <> 'superseded'`,
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
