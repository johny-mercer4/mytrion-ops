import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { DEFAULT_RETRIEVAL_K, MAX_RETRIEVAL_K } from '../../config/constants.js';
import { env } from '../../config/env.js';
import { normalizeDepartment, normalizeDepartments } from '../../lib/department.js';
import { AppError, NotFoundError } from '../../lib/errors.js';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import { ingestDocument, type IngestResult } from '../../modules/knowledge/ingestService.js';
import { retrieve } from '../../modules/knowledge/retriever.js';
import { knowledgeRepo } from '../../repos/knowledgeRepo.js';
import { requireContext, withDepartmentAccess } from './helpers.js';

const embedSchema = z.object({
  title: z.string().min(1).max(500),
  content: z.string().min(1).max(1_000_000),
  source: z.string().max(1000).optional(),
  mimeType: z.string().max(200).optional(),
  /** Department this doc belongs to (RBAC). Omit/empty = shared/global. */
  department: z.string().min(1).max(60).optional(),
  /** Alias accepted from callers that use the chat-side name. */
  department_scope: z.string().min(1).max(60).optional(),
});

const querySchema = z.object({
  query: z.string().min(1).max(1000),
  limit: z.number().int().min(1).max(MAX_RETRIEVAL_K).optional(),
  // Department-access RBAC for retrieval (caller-supplied).
  departmentAccess: z.array(z.string().min(1).max(60)).max(50).optional(),
  allDepartments: z.boolean().optional(),
});

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  department: z.string().min(1).max(60).optional(),
});

const chunkQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const bulkDeleteSchema = z.object({
  ids: z.array(z.string().min(1).max(100)).min(1).max(100),
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

/**
 * Knowledge endpoints powering the Agent Scope widget: ingest .md/text into pgvector,
 * list ingested docs, and inspect embedded chunks. Authenticated by the static API_KEY.
 */
export async function knowledgeRoutes(app: FastifyInstance): Promise<void> {
  // Internal management surface: customer sessions (carrier-client logins) are denied outright —
  // several repo paths here are tenant-scoped only, and the KB is internal data regardless.
  const guard = {
    onRequest: [app.sessionOrApiKey],
    preHandler: [app.requireAudience('internal', 'partner')],
  };
  // Mutating the shared KB corpus (ingest + delete) is an admin-only curation action: a non-admin
  // worker must not be able to poison the RAG grounding corpus or destroy documents. The static
  // API-key systemContext is role 'admin', so server-to-server tooling is unaffected.
  const writeGuard = {
    onRequest: [app.sessionOrApiKey],
    preHandler: [app.requireAudience('internal', 'partner'), app.requireRole('admin')],
  };

  // --- Ingest: raw text body ---
  app.post('/knowledge/embed', writeGuard, async (request) => {
    assertIngestEnabled();
    const ctx = requireContext(request);
    const body = embedSchema.parse(request.body);
    const department = body.department ?? body.department_scope;
    return ingestDocument(ctx, {
      title: body.title,
      content: body.content,
      ...(body.source !== undefined ? { source: body.source } : {}),
      ...(body.mimeType !== undefined ? { mimeType: body.mimeType } : {}),
      ...(department !== undefined ? { department } : {}),
    });
  });

  // --- Ingest: file upload (mainly .md). Multipart: file part(s) + optional `department` field ---
  app.post('/knowledge/upload', writeGuard, async (request) => {
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
    const department = (fields.department ?? fields.department_scope)?.trim() || null;

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

  // --- Inspect: list ingested docs (optionally filter by department) ---
  app.get('/knowledge/docs', guard, async (request) => {
    const ctx = requireContext(request);
    const q = listQuerySchema.parse(request.query);
    const page: { limit?: number; offset?: number; department?: string } = {};
    if (q.limit !== undefined) page.limit = q.limit;
    if (q.offset !== undefined) page.offset = q.offset;
    const dept = normalizeDepartment(q.department);
    if (dept) page.department = dept;
    const docs = await knowledgeRepo.listDocs(ctx, page);
    return { docs };
  });

  // --- Inspect: knowledge totals (for the widget header) ---
  app.get('/knowledge/stats', guard, async (request) => {
    const ctx = requireContext(request);
    const [docs, chunks] = await Promise.all([
      knowledgeRepo.countDocs(ctx),
      knowledgeRepo.countChunks(ctx),
    ]);
    return { docs, chunks };
  });

  // --- Inspect: a single doc ---
  app.get<{ Params: { id: string } }>('/knowledge/docs/:id', guard, async (request) => {
    const ctx = requireContext(request);
    const doc = await knowledgeRepo.findDoc(ctx, request.params.id);
    if (!doc) throw new NotFoundError('Knowledge doc not found');
    return { doc };
  });

  // --- Inspect: a doc's embedded chunks (content + whether a vector is stored) ---
  app.get<{ Params: { id: string } }>('/knowledge/docs/:id/chunks', guard, async (request) => {
    const ctx = requireContext(request);
    const doc = await knowledgeRepo.findDoc(ctx, request.params.id);
    if (!doc) throw new NotFoundError('Knowledge doc not found');
    const q = chunkQuerySchema.parse(request.query);
    const page: { limit?: number; offset?: number } = {};
    if (q.limit !== undefined) page.limit = q.limit;
    if (q.offset !== undefined) page.offset = q.offset;
    const chunks = await knowledgeRepo.listChunksByDoc(ctx, doc.id, page);
    return { docId: doc.id, chunks };
  });

  // --- Delete: remove a doc and all its embedded chunks (cascade) ---
  // Hard delete → the doc's checksum is gone, so re-uploading the same file re-ingests fresh.
  async function deleteOne(request: FastifyRequest<{ Params: { id: string } }>) {
    const ctx = requireContext(request);
    const deleted = await knowledgeRepo.deleteDoc(ctx, request.params.id);
    if (!deleted) throw new NotFoundError(`No document with id ${request.params.id}`);
    await auditFromContext(ctx, {
      action: 'knowledge.delete',
      status: 'ok',
      resourceType: 'knowledge_doc',
      resourceId: request.params.id,
      detail: { title: deleted.title, chunksDeleted: deleted.chunkCount },
    });
    return { deleted };
  }

  app.delete<{ Params: { id: string } }>('/knowledge/docs/:id', writeGuard, deleteOne);
  // POST alias — Zoho's server-side proxy reliably supports POST but not always DELETE.
  app.post<{ Params: { id: string } }>('/knowledge/docs/:id/delete', writeGuard, deleteOne);

  // Freshness attest: resets last_verified_at so retrieval stops demoting the doc as stale.
  app.post<{ Params: { id: string } }>('/knowledge/docs/:id/verify', writeGuard, async (request) => {
    const ctx = withDepartmentAccess(requireContext(request), request);
    const verified = await knowledgeRepo.markVerified(ctx, request.params.id);
    if (!verified) throw new NotFoundError('Document not found');
    await auditFromContext(ctx, {
      action: 'knowledge.verify',
      status: 'ok',
      resourceType: 'knowledge_doc',
      resourceId: request.params.id,
    });
    return { verified: true, id: request.params.id };
  });

  // Bulk delete: POST /knowledge/docs/delete  { ids: [...] }
  app.post('/knowledge/docs/delete', writeGuard, async (request) => {
    const ctx = requireContext(request);
    const { ids } = bulkDeleteSchema.parse(request.body);
    const deleted: Array<{ id: string; title: string; chunkCount: number }> = [];
    const notFound: string[] = [];
    for (const id of [...new Set(ids)]) {
      const row = await knowledgeRepo.deleteDoc(ctx, id);
      if (row) deleted.push(row);
      else notFound.push(id);
    }
    await auditFromContext(ctx, {
      action: 'knowledge.delete',
      status: 'ok',
      resourceType: 'knowledge_doc',
      detail: { bulk: true, deleted: deleted.map((d) => d.id), notFound },
    });
    return { deleted, notFound };
  });

  // --- Retrieve: RBAC-scoped kNN search (caller passes department access) ---
  app.post('/knowledge/query', guard, async (request) => {
    const body = querySchema.parse(request.body);
    let ctx = withDepartmentAccess(requireContext(request), request, body);
    // An EXPLICIT departmentAccess filter (without allDepartments) is a NARROWING request —
    // the admin retrieval-test UI scopes "what would a sales agent see". withDepartmentAccess
    // can only widen (admin sessions already carry allDepartmentAccess), so apply the narrow
    // here. For a VERIFIED non-admin worker the request is bounded by what the session already
    // grants (profile-derived departments) so the body can't widen access; admins and unverified
    // API-key callers are trusted to assert any scope.
    if (body.departmentAccess !== undefined && body.allDepartments !== true) {
      const requested = normalizeDepartments(body.departmentAccess);
      const granted = ctx.departments;
      const bounded =
        ctx.sessionVerified && !ctx.allDepartmentAccess
          ? requested.filter((d) => granted.includes(d))
          : requested;
      ctx = { ...ctx, allDepartmentAccess: false, departments: bounded };
    }
    const passages = await retrieve(ctx, body.query, body.limit ?? DEFAULT_RETRIEVAL_K);
    return { passages };
  });
}
