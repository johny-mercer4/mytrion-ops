import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DEFAULT_RETRIEVAL_K, MAX_RETRIEVAL_K } from '../../config/constants.js';
import { env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import { ingestDocument, type IngestResult } from '../../modules/knowledge/ingestService.js';
import { retrieve } from '../../modules/knowledge/retriever.js';
import { requireContext, withDepartmentAccess } from './helpers.js';

const embedSchema = z.object({
  title: z.string().min(1).max(500),
  content: z.string().min(1).max(1_000_000),
  source: z.string().max(1000).optional(),
  mimeType: z.string().max(200).optional(),
  /** Department this doc belongs to (RBAC). Omit/empty = shared/global. */
  department: z.string().min(1).max(60).optional(),
});

const querySchema = z.object({
  query: z.string().min(1).max(1000),
  limit: z.number().int().min(1).max(MAX_RETRIEVAL_K).optional(),
  // Department-access RBAC for retrieval (caller-supplied).
  departmentAccess: z.array(z.string().min(1).max(60)).max(50).optional(),
  allDepartments: z.boolean().optional(),
});

/** Text formats we accept for upload-based training. */
const TEXT_EXTENSIONS = new Set(['.md', '.markdown', '.txt', '.text', '.json']);

function isTextUpload(filename: string, mimetype: string): boolean {
  const dot = filename.lastIndexOf('.');
  const ext = dot >= 0 ? filename.slice(dot).toLowerCase() : '';
  return TEXT_EXTENSIONS.has(ext) || mimetype.startsWith('text/');
}

function assertIngestEnabled(): void {
  if (!env.FF_KNOWLEDGE_INGEST_ENABLED) {
    throw new AppError('Knowledge ingestion is disabled', {
      statusCode: 503,
      code: 'FEATURE_DISABLED',
      expose: true,
    });
  }
}

export async function knowledgeRoutes(app: FastifyInstance): Promise<void> {
  // Knowledge curation is an internal task; restrict to admin/ops.
  const curatorGuard = { onRequest: [app.authenticate], preHandler: [app.requireRole('admin', 'ops')] };

  app.post('/knowledge/embed', curatorGuard, async (request) => {
    assertIngestEnabled();
    const ctx = requireContext(request);
    const body = embedSchema.parse(request.body);
    return ingestDocument(ctx, {
      title: body.title,
      content: body.content,
      ...(body.source !== undefined ? { source: body.source } : {}),
      ...(body.mimeType !== undefined ? { mimeType: body.mimeType } : {}),
      ...(body.department !== undefined ? { department: body.department } : {}),
    });
  });

  /**
   * Upload one or more text files (mainly .md) to train the AI. Multipart form: file
   * part(s) plus an optional `department` field that tags every uploaded doc for RBAC.
   */
  app.post('/knowledge/upload', curatorGuard, async (request) => {
    assertIngestEnabled();
    const ctx = requireContext(request);

    const fields: Record<string, string> = {};
    const files: Array<{ filename: string; mimetype: string; content: string }> = [];
    for await (const part of request.parts()) {
      if (part.type === 'file') {
        if (!isTextUpload(part.filename, part.mimetype)) {
          throw new AppError(`Unsupported file type: ${part.filename} (text/.md only)`, {
            statusCode: 415,
            code: 'UNSUPPORTED_MEDIA_TYPE',
            expose: true,
          });
        }
        const buf = await part.toBuffer();
        files.push({ filename: part.filename, mimetype: part.mimetype, content: buf.toString('utf8') });
      } else {
        fields[part.fieldname] = part.value as string;
      }
    }

    if (files.length === 0) {
      throw new AppError('No files in upload', { statusCode: 400, code: 'NO_FILES', expose: true });
    }
    const department = fields.department?.trim() || null;

    const results: Array<IngestResult & { filename: string }> = [];
    for (const file of files) {
      const result = await ingestDocument(ctx, {
        title: file.filename,
        content: file.content,
        source: `upload:${file.filename}`,
        mimeType: file.mimetype || 'text/markdown',
        department,
      });
      results.push({ ...result, filename: file.filename });
    }
    return { department, uploaded: results };
  });

  app.post('/knowledge/query', { onRequest: [app.authenticate] }, async (request) => {
    const body = querySchema.parse(request.body);
    const ctx = withDepartmentAccess(requireContext(request), request, body);
    const passages = await retrieve(ctx, body.query, body.limit ?? DEFAULT_RETRIEVAL_K);
    return { passages };
  });
}
