import { createHash } from 'node:crypto';
import { normalizeDepartment } from '../../lib/department.js';
import { AppError, errorMessage } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { knowledgeRepo, type NewChunkInput } from '../../repos/knowledgeRepo.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { auditFromContext } from '../audit/auditLogger.js';
import { chunkText, contextualizeChunk } from './chunker.js';
import { embedTexts } from './embedder.js';
import { EMBEDDING_DIMENSIONS } from '../../config/constants.js';
import { env } from '../../config/env.js';
import type { KnowledgeAuthorityClass, KnowledgeDomain } from '../../db/schema/index.js';

export interface IngestInput {
  title: string;
  content: string;
  source?: string;
  mimeType?: string;
  /** Department this doc belongs to (RBAC). null/undefined = shared/global. */
  department?: string | null;
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
  /** Deterministic allowlisted runtime catalogs may attest themselves after validation. */
  verified?: boolean;
}

export interface IngestResult {
  docId: string;
  chunkCount: number;
  /** ready = embedded; updated = same content, department re-tagged; skipped = identical no-op. */
  status: 'ready' | 'skipped' | 'updated';
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/** Rough token estimate (~4 chars/token) — good enough for storage/telemetry. */
function approxTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

async function handleReadyDuplicate(
  ctx: TenantContext,
  existing: Awaited<ReturnType<typeof knowledgeRepo.findDocByChecksum>>,
  department: string | null,
): Promise<IngestResult | null> {
  if (!existing || existing.status !== 'ready') return null;
  if (existing.departmentAccess !== department) {
    await knowledgeRepo.setDepartment(ctx, existing.id, department);
    await auditFromContext(ctx, {
      action: 'knowledge.retag',
      status: 'ok',
      resourceType: 'knowledge_doc',
      resourceId: existing.id,
      detail: { departmentAccess: department },
    });
    logger.debug({ docId: existing.id, department }, 'ingest re-tagged department (checksum match)');
    return { docId: existing.id, chunkCount: existing.chunkCount, status: 'updated' };
  }
  logger.debug({ docId: existing.id, tenantId: ctx.tenantId }, 'ingest skipped (checksum match)');
  return { docId: existing.id, chunkCount: existing.chunkCount, status: 'skipped' };
}

function assertGovernanceMetadata(input: IngestInput): void {
  if (!input.title.trim() || input.title.length > 500) {
    throw new AppError('Knowledge document title is required and must be at most 500 characters', {
      code: 'KNOWLEDGE_INVALID_TITLE',
      statusCode: 400,
    });
  }
  if (!/^[A-Za-z]{2,12}(?:-[A-Za-z0-9]{2,12})?$/.test(input.language ?? 'en')) {
    throw new AppError('Knowledge document language must be a valid language tag', {
      code: 'KNOWLEDGE_INVALID_LANGUAGE',
      statusCode: 400,
    });
  }
  if (input.domain === 'platform' && (!input.source || !input.owner || !input.sourceVersion)) {
    throw new AppError('Platform knowledge requires source, owner, and sourceVersion metadata', {
      code: 'KNOWLEDGE_PLATFORM_METADATA_REQUIRED',
      statusCode: 400,
    });
  }
  if (
    (input.effectiveAt && !Number.isFinite(input.effectiveAt.getTime())) ||
    (input.expiresAt && !Number.isFinite(input.expiresAt.getTime())) ||
    (input.effectiveAt && input.expiresAt && input.expiresAt <= input.effectiveAt)
  ) {
    throw new AppError('Knowledge freshness dates are invalid or expiresAt is not after effectiveAt', {
      code: 'KNOWLEDGE_INVALID_FRESHNESS',
      statusCode: 400,
    });
  }
}

/**
 * Ingest a document end to end: dedupe by checksum, chunk, embed, and atomically
 * replace chunks in pgvector. Idempotent — re-ingesting identical, already-ready
 * content is skipped. Tenant + audience come from ctx (isolation enforced in repo).
 */
export async function ingestDocument(ctx: TenantContext, input: IngestInput): Promise<IngestResult> {
  assertGovernanceMetadata(input);
  const normalizedContent = input.content.replace(/\r\n/g, '\n').trim();
  if (normalizedContent.length === 0) {
    throw new AppError('Knowledge document is empty after extraction', {
      code: 'KNOWLEDGE_EMPTY_CONTENT',
      statusCode: 400,
    });
  }
  if (normalizedContent.length > 5_000_000) {
    throw new AppError('Knowledge document exceeds the 5,000,000 character admission limit', {
      code: 'KNOWLEDGE_CONTENT_TOO_LARGE',
      statusCode: 413,
    });
  }
  const checksum = sha256(normalizedContent);
  // Normalize so ingest- and query-side tags can't drift. null = Global.
  const department = normalizeDepartment(input.department);
  const existing = await knowledgeRepo.findDocByChecksum(ctx, checksum);

  const readyDuplicate = await handleReadyDuplicate(ctx, existing, department);
  if (readyDuplicate) return readyDuplicate;
  if (existing && existing.status !== 'failed') {
    throw new AppError('An identical knowledge document is already being ingested', {
      code: 'KNOWLEDGE_INGEST_IN_PROGRESS',
      statusCode: 409,
    });
  }

  let doc = existing;
  if (!doc) {
    const admitted = await knowledgeRepo.createDoc(ctx, {
      title: input.title,
      checksum,
      departmentAccess: department,
      ...(input.source !== undefined ? { source: input.source } : {}),
      ...(input.mimeType !== undefined ? { mimeType: input.mimeType } : {}),
      ...(input.origin !== undefined ? { origin: input.origin } : {}),
      ...(input.domain !== undefined ? { domain: input.domain } : {}),
      ...(input.language !== undefined ? { language: input.language } : {}),
      ...(input.authorityClass !== undefined ? { authorityClass: input.authorityClass } : {}),
      ...(input.owner !== undefined ? { owner: input.owner } : {}),
      ...(input.sourceVersion !== undefined ? { sourceVersion: input.sourceVersion } : {}),
      ...(input.sourceCommit !== undefined ? { sourceCommit: input.sourceCommit } : {}),
      ...(input.supersedesDocId !== undefined ? { supersedesDocId: input.supersedesDocId } : {}),
      ...(input.effectiveAt !== undefined ? { effectiveAt: input.effectiveAt } : {}),
      ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
      ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
    });
    doc = admitted.doc;
    if (!admitted.inserted) {
      const racedReady = await handleReadyDuplicate(ctx, doc, department);
      if (racedReady) return racedReady;
      if (doc.status !== 'failed') {
        throw new AppError('An identical knowledge document is already being ingested', {
          code: 'KNOWLEDGE_INGEST_IN_PROGRESS',
          statusCode: 409,
        });
      }
    }
  }

  await knowledgeRepo.updateDoc(ctx, doc.id, { status: 'processing', error: null });

  try {
    const chunks = chunkText(normalizedContent);
    if (chunks.length === 0) {
      throw new AppError('Chunking produced no usable knowledge content', {
        code: 'KNOWLEDGE_NO_CHUNKS',
        statusCode: 422,
      });
    }

    const sourceVersion = input.sourceVersion ?? doc.sourceVersion ?? '1';
    const retrievalTexts = chunks.map((chunk) =>
      contextualizeChunk(chunk, {
        title: input.title,
        ...(input.source ? { source: input.source } : {}),
        domain: input.domain ?? 'operations',
        language: input.language ?? 'en',
      }),
    );
    const embeddings = await embedTexts(retrievalTexts);
    if (embeddings.length !== chunks.length) {
      throw new AppError('Embedding count does not match chunk count', {
        code: 'EMBEDDING_COUNT_MISMATCH',
        statusCode: 502,
      });
    }
    const chunkInputs: NewChunkInput[] = [];
    for (let i = 0; i < chunks.length; i += 1) {
      const chunk = chunks[i];
      const embedding = embeddings[i];
      const retrievalText = retrievalTexts[i];
      if (!chunk || !embedding || !retrievalText) {
        throw new AppError(`Missing chunk or embedding at index ${i}`, {
          code: 'EMBEDDING_COUNT_MISMATCH',
          statusCode: 502,
        });
      }
      if (embedding.length !== EMBEDDING_DIMENSIONS || embedding.some((value) => !Number.isFinite(value))) {
        throw new AppError(`Embedding at index ${i} is not a finite ${EMBEDDING_DIMENSIONS}-dimension vector`, {
          code: 'EMBEDDING_DIMENSION_MISMATCH',
          statusCode: 502,
        });
      }
      chunkInputs.push({
        chunkIndex: chunk.index,
        content: chunk.content,
        retrievalText,
        contentHash: sha256(chunk.content.replace(/\s+/g, ' ').trim()),
        ...(chunk.sectionPath ? { sectionPath: chunk.sectionPath } : {}),
        embeddingModel: env.OPEN_AI_EMBEDDING_SMALL,
        embeddingDimensions: EMBEDDING_DIMENSIONS,
        sourceVersion,
        embedding,
        tokenCount: approxTokens(chunk.content),
      });
    }

    await knowledgeRepo.commitIngestion(ctx, doc.id, chunkInputs, department, input.supersedesDocId);
    if (input.verified) await knowledgeRepo.markVerified(ctx, doc.id);
    await auditFromContext(ctx, {
      action: 'knowledge.embed',
      status: 'ok',
      resourceType: 'knowledge_doc',
      resourceId: doc.id,
      detail: { chunkCount: chunkInputs.length },
    });
    return { docId: doc.id, chunkCount: chunkInputs.length, status: 'ready' };
  } catch (err) {
    const message = errorMessage(err);
    await knowledgeRepo.updateDoc(ctx, doc.id, { status: 'failed', error: message });
    await auditFromContext(ctx, {
      action: 'knowledge.embed',
      status: 'error',
      resourceType: 'knowledge_doc',
      resourceId: doc.id,
      detail: { error: message },
    });
    throw err;
  }
}
