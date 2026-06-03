import { createHash } from 'node:crypto';
import { errorMessage } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { knowledgeRepo, type NewChunkInput } from '../../repos/knowledgeRepo.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { auditFromContext } from '../audit/auditLogger.js';
import { chunkText } from './chunker.js';
import { embedTexts } from './embedder.js';

export interface IngestInput {
  title: string;
  content: string;
  source?: string;
  mimeType?: string;
}

export interface IngestResult {
  docId: string;
  chunkCount: number;
  status: 'ready' | 'skipped';
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/** Rough token estimate (~4 chars/token) — good enough for storage/telemetry. */
function approxTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

/**
 * Ingest a document end to end: dedupe by checksum, chunk, embed, and atomically
 * replace chunks in pgvector. Idempotent — re-ingesting identical, already-ready
 * content is skipped. Tenant + audience come from ctx (isolation enforced in repo).
 */
export async function ingestDocument(ctx: TenantContext, input: IngestInput): Promise<IngestResult> {
  const checksum = sha256(input.content);
  const existing = await knowledgeRepo.findDocByChecksum(ctx, checksum);

  if (existing && existing.status === 'ready') {
    logger.debug({ docId: existing.id, tenantId: ctx.tenantId }, 'ingest skipped (checksum match)');
    return { docId: existing.id, chunkCount: existing.chunkCount, status: 'skipped' };
  }

  const doc =
    existing ??
    (await knowledgeRepo.createDoc(ctx, {
      title: input.title,
      checksum,
      ...(input.source !== undefined ? { source: input.source } : {}),
      ...(input.mimeType !== undefined ? { mimeType: input.mimeType } : {}),
    }));

  await knowledgeRepo.updateDoc(ctx, doc.id, { status: 'processing', error: null });

  try {
    const chunks = chunkText(input.content);
    if (chunks.length === 0) {
      await knowledgeRepo.updateDoc(ctx, doc.id, { status: 'ready', chunkCount: 0 });
      return { docId: doc.id, chunkCount: 0, status: 'ready' };
    }

    const embeddings = await embedTexts(chunks.map((c) => c.content));
    const chunkInputs: NewChunkInput[] = [];
    for (let i = 0; i < chunks.length; i += 1) {
      const chunk = chunks[i];
      const embedding = embeddings[i];
      if (!chunk || !embedding) continue;
      chunkInputs.push({
        chunkIndex: chunk.index,
        content: chunk.content,
        embedding,
        tokenCount: approxTokens(chunk.content),
      });
    }

    await knowledgeRepo.replaceChunks(ctx, doc.id, chunkInputs);
    await knowledgeRepo.updateDoc(ctx, doc.id, {
      status: 'ready',
      chunkCount: chunkInputs.length,
      error: null,
    });
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
