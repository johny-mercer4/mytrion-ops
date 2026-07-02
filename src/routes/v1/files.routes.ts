/**
 * File routes: upload (multipart) for analysis/ingest, list, metadata, presigned download,
 * delete. Same caller-identity RBAC as chat; visibility is department/ownership-scoped in
 * fileRepo. All routes 503 when FF_FILES_ENABLED is off.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { AppError, ValidationError } from '../../lib/errors.js';
import { deleteFile, maxFileBytes, presignFile, storeFile } from '../../modules/files/fileService.js';
import { fileRepo } from '../../repos/fileRepo.js';
import type { FileAsset } from '../../db/schema/index.js';
import { buildCallerContext, callerIdentitySchema } from './callerIdentity.js';

function requireFiles(): void {
  if (!env.FF_FILES_ENABLED) {
    throw new AppError('File storage is disabled (set FF_FILES_ENABLED).', {
      statusCode: 503,
      code: 'FEATURE_DISABLED',
    });
  }
}

function fileDto(f: FileAsset) {
  return {
    id: f.id,
    name: f.name,
    mime: f.mime,
    sizeBytes: f.sizeBytes,
    kind: f.kind,
    departmentAccess: f.departmentAccess ?? null,
    createdBy: f.createdBy ?? null,
    createdAt: f.createdAt.toISOString(),
  };
}

export async function filesRoutes(app: FastifyInstance): Promise<void> {
  const guard = { onRequest: [app.sessionOrApiKey] };

  // Multipart upload; identity fields arrive as form fields alongside the file.
  app.post('/files/upload', guard, async (request, reply) => {
    requireFiles();
    const part = await request.file({ limits: { fileSize: maxFileBytes() } });
    if (!part) throw new ValidationError('Expected a multipart file field');
    const buffer = await part.toBuffer();
    const fields: Record<string, string> = {};
    for (const [key, value] of Object.entries(part.fields)) {
      const v = Array.isArray(value) ? value[0] : value;
      if (v && typeof v === 'object' && 'value' in v && typeof v.value === 'string') {
        fields[key] = v.value;
      }
    }
    const identity = callerIdentitySchema.parse(fields);
    const ctx = buildCallerContext(request, identity);
    const stored = await storeFile(ctx, {
      name: part.filename || 'upload',
      mime: part.mimetype || 'application/octet-stream',
      buffer,
      kind: 'upload',
      createdBy: 'files.upload',
      ...(fields['department'] ? { department: fields['department'] } : {}),
    });
    void reply.code(201);
    return { file: stored };
  });

  app.get('/files', guard, async (request) => {
    requireFiles();
    const q = z.object({ limit: z.coerce.number().int().min(1).max(100).optional() }).parse(request.query);
    const ctx = buildCallerContext(request, callerIdentitySchema.parse(request.query));
    const files = await fileRepo.listVisible(ctx, q.limit ?? 50);
    return { files: files.map(fileDto) };
  });

  app.get<{ Params: { id: string } }>('/files/:id', guard, async (request) => {
    requireFiles();
    const ctx = buildCallerContext(request, callerIdentitySchema.parse(request.query));
    const { file } = await presignFile(ctx, request.params.id);
    return { file: fileDto(file) };
  });

  app.get<{ Params: { id: string } }>('/files/:id/download', guard, async (request) => {
    requireFiles();
    const ctx = buildCallerContext(request, callerIdentitySchema.parse(request.query));
    const { file, url, expiresAt } = await presignFile(ctx, request.params.id);
    return { id: file.id, name: file.name, url, expiresAt };
  });

  app.post<{ Params: { id: string } }>('/files/:id/delete', guard, async (request) => {
    requireFiles();
    const ctx = buildCallerContext(request, callerIdentitySchema.parse(request.body ?? {}));
    await deleteFile(ctx, request.params.id);
    return { deleted: true, id: request.params.id };
  });
}
