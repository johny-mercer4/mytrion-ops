/**
 * File lifecycle: store (generated artifact or upload) → catalog row → presigned download.
 * Keys are tenant-prefixed (`<tenant>/<kind>/<yyyy-mm>/<fileId>/<name>`); size caps enforced
 * here so neither tools nor routes can bypass them.
 */
import { createId } from '@paralleldrive/cuid2';
import { env } from '../../config/env.js';
import { AppError, NotFoundError } from '../../lib/errors.js';
import { fileRepo } from '../../repos/fileRepo.js';
import type { FileAsset } from '../../db/schema/index.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { auditFromContext } from '../audit/auditLogger.js';
import { getStorage } from './storage/index.js';

export interface StoreFileInput {
  name: string;
  mime: string;
  buffer: Buffer;
  kind: 'generated' | 'upload';
  createdBy: string;
  department?: string | null;
  conversationId?: string;
  agentTaskId?: string;
}

export interface StoredFile {
  fileId: string;
  name: string;
  mime: string;
  sizeBytes: number;
  url: string;
  expiresAt: string;
}

function sanitizeName(name: string): string {
  const base =
    name
      .replace(/[/\\]/g, '_')
      .replace(/[^\w.\- ]/g, '')
      .replace(/\.{2,}/g, '.') // no '..' sequences — keys stay unambiguous
      .replace(/^[. ]+/, '')
      .trim() || 'file';
  return base.slice(0, 120);
}

export function maxFileBytes(): number {
  return env.FILE_MAX_SIZE_MB * 1024 * 1024;
}

export async function storeFile(ctx: TenantContext, input: StoreFileInput): Promise<StoredFile> {
  if (input.buffer.length === 0) {
    throw new AppError('Refusing to store an empty file', { statusCode: 400, code: 'EMPTY_FILE' });
  }
  if (input.buffer.length > maxFileBytes()) {
    throw new AppError(`File exceeds the ${env.FILE_MAX_SIZE_MB}MB limit`, {
      statusCode: 413,
      code: 'FILE_TOO_LARGE',
    });
  }
  const fileId = createId();
  const name = sanitizeName(input.name);
  const month = new Date().toISOString().slice(0, 7);
  const key = `${ctx.tenantId}/${input.kind}/${month}/${fileId}/${name}`;
  await getStorage().put(key, input.buffer, { contentType: input.mime });
  await fileRepo.create(ctx, {
    id: fileId,
    ownerUserId: ctx.userId,
    // Customer callers never set department tags on files — owner scoping only.
    departmentAccess: ctx.audience === 'customer' ? null : (input.department ?? null),
    name,
    mime: input.mime,
    sizeBytes: input.buffer.length,
    s3Key: key,
    kind: input.kind,
    createdBy: input.createdBy,
    ...(input.conversationId ? { conversationId: input.conversationId } : {}),
    ...(input.agentTaskId ? { agentTaskId: input.agentTaskId } : {}),
  });
  await auditFromContext(ctx, {
    action: 'file.store',
    status: 'ok',
    resourceType: 'file',
    resourceId: fileId,
    detail: { name, kind: input.kind, sizeBytes: input.buffer.length, by: input.createdBy },
  });
  const link = await getStorage().presignGet(key, { filename: name });
  return {
    fileId,
    name,
    mime: input.mime,
    sizeBytes: input.buffer.length,
    url: link.url,
    expiresAt: link.expiresAt.toISOString(),
  };
}

/** RBAC-checked presign for an existing file. */
export async function presignFile(
  ctx: TenantContext,
  fileId: string,
): Promise<{ file: FileAsset; url: string; expiresAt: string }> {
  const file = await fileRepo.findVisible(ctx, fileId);
  if (!file) throw new NotFoundError('File not found');
  const link = await getStorage().presignGet(file.s3Key, { filename: file.name });
  return { file, url: link.url, expiresAt: link.expiresAt.toISOString() };
}

/** RBAC-checked bounded read (parse path). */
export async function readFileBuffer(ctx: TenantContext, fileId: string): Promise<{ file: FileAsset; buffer: Buffer }> {
  const file = await fileRepo.findVisible(ctx, fileId);
  if (!file) throw new NotFoundError('File not found');
  const buffer = await getStorage().getBuffer(file.s3Key, env.PARSE_MAX_BYTES);
  return { file, buffer };
}

export async function deleteFile(ctx: TenantContext, fileId: string): Promise<void> {
  const removed = await fileRepo.markDeleted(ctx, fileId);
  if (!removed) throw new NotFoundError('File not found (or not yours to delete)');
  try {
    await getStorage().delete(removed.s3Key);
  } catch {
    // Row is authoritative; a dangling object is cleaned up by bucket lifecycle rules.
  }
  await auditFromContext(ctx, {
    action: 'file.delete',
    status: 'ok',
    resourceType: 'file',
    resourceId: fileId,
  });
}
