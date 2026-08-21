/**
 * Files on a collection case — the agency letter, the court filing, the USPS proof of mailing.
 *
 * Zoho carried an Attachments related list on every record and the Postgres desk had nowhere to
 * put a document at all, which is the difference between "we filed in small claims" being a
 * checkbox and being a claim you can evidence.
 *
 * Metadata in Postgres, bytes through the same object-storage seam `files.routes.ts` and CS
 * Maintenance use. The provider is decided ONCE per file and recorded on the row, so every later
 * read and delete resolves the same store no matter what the env says by then.
 *
 * Deliberately reuses `MAINTENANCE_STORAGE_PROVIDER` rather than adding a
 * `COLLECTION_STORAGE_PROVIDER` nobody has set: a third switch that always has to be flipped in
 * step with the second is a configuration trap, not a feature. If collections ever needs its own
 * bucket, that is the moment to add one.
 */
import { createId } from '@paralleldrive/cuid2';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { AppError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import { maxFileBytes } from '../../modules/files/fileService.js';
import { maintenanceStorageProvider, storageFor } from '../../modules/files/storage/index.js';
import { COLLECTION_ATTACHMENT_KINDS } from '../../db/schema/collection_case_attachments.js';
import { collectionActivityRepo } from '../../repos/collectionActivityRepo.js';
import { collectionCaseAttachmentRepo } from '../../repos/collectionCaseAttachmentRepo.js';
import { collectionCaseRepo } from '../../repos/collectionCaseRepo.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { requireDepartment } from './helpers.js';

const idParams = z.object({ id: z.string().min(1).max(80) });
const attachmentParams = idParams.extend({ attId: z.string().min(1).max(80) });
const kindQuery = z.object({ kind: z.enum(COLLECTION_ATTACHMENT_KINDS).optional() });

function requireCollection(request: FastifyRequest): TenantContext {
  return requireDepartment(request, 'collection', 'Collection desk');
}

/**
 * Checks the provider a NEW upload would use, not every provider ever configured — a
 * Dropbox-configured env still carries stale S3 creds, and those must not block uploads once
 * Dropbox is the live path.
 */
function requireStorageConfigured(): void {
  if (maintenanceStorageProvider() === 'dropbox_maintenance') {
    if (!env.DROPBOX_APP_KEY || !env.DROPBOX_APP_SECRET || !env.DROPBOX_REFRESH_TOKEN) {
      throw new AppError(
        'File storage is not configured in this environment (DROPBOX_APP_KEY/DROPBOX_APP_SECRET/DROPBOX_REFRESH_TOKEN) — attachments are unavailable here.',
        { statusCode: 503, code: 'STORAGE_NOT_CONFIGURED', expose: true },
      );
    }
    return;
  }
  if (!env.S3_ENDPOINT || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY || !env.S3_BUCKET) {
    throw new AppError(
      'File storage is not configured in this environment (S3_ENDPOINT/S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY/S3_BUCKET) — attachments are unavailable here.',
      { statusCode: 503, code: 'STORAGE_NOT_CONFIGURED', expose: true },
    );
  }
}

/** Strips path separators and traversal sequences — this name becomes part of an object key. */
function sanitizeFileName(name: string): string {
  const base =
    name
      .replace(/[/\\]/g, '_')
      .replace(/\.{2,}/g, '.')
      .trim() || 'file';
  return base.slice(0, 200);
}

export async function collectionAttachmentRoutes(app: FastifyInstance): Promise<void> {
  const auth = { onRequest: [app.authenticate] };

  async function requireCase(request: FastifyRequest, id: string) {
    const ctx = requireCollection(request);
    const row = await collectionCaseRepo.findById(ctx, id);
    if (!row) throw new NotFoundError('Collection case not found');
    return { ctx, row };
  }

  app.get<{ Params: { id: string } }>(
    '/collection/cases/:id/attachments',
    auth,
    async (request) => {
      const { id } = idParams.parse(request.params);
      await requireCase(request, id);
      return { items: await collectionCaseAttachmentRepo.listByCaseId(id) };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/collection/cases/:id/attachments',
    auth,
    async (request, reply) => {
      const { id } = idParams.parse(request.params);
      const { ctx } = await requireCase(request, id);
      requireStorageConfigured();
      const { kind } = kindQuery.parse(request.query);

      const part = await request.file({ limits: { fileSize: maxFileBytes() } });
      if (!part) throw new ValidationError('Expected a multipart file field');
      const buffer = await part.toBuffer();
      if (buffer.length === 0) {
        throw new AppError('Refusing to store an empty file', {
          statusCode: 400,
          code: 'EMPTY_FILE',
          expose: true,
        });
      }

      const fileName = sanitizeFileName(part.filename || 'attachment');
      const mime = part.mimetype || 'application/octet-stream';
      const s3Key = `collection/${id}/${createId()}-${fileName}`;
      const provider = maintenanceStorageProvider();
      await storageFor(provider).put(s3Key, buffer, { contentType: mime });

      const row = await collectionCaseAttachmentRepo.insert({
        caseId: id,
        fileName,
        mime,
        sizeBytes: buffer.length,
        s3Key,
        storageProvider: provider,
        ...(kind !== undefined ? { kind } : {}),
        ...(ctx.userId !== undefined ? { uploadedByUserId: ctx.userId } : {}),
        ...(ctx.userName !== undefined ? { uploadedByName: ctx.userName } : {}),
      });

      // On the timeline as well as in the list: "we posted the letter on the 4th" is a fact about
      // the case, not just a file sitting in a folder.
      await collectionActivityRepo.insert({
        caseId: id,
        kind: 'note',
        summary: `Attached ${fileName}`,
        meta: { attachmentId: row?.id, fileName, sizeBytes: buffer.length, ...(kind ? { kind } : {}) },
        ...(ctx.userId !== undefined ? { actorUserId: ctx.userId } : {}),
        ...(ctx.userName !== undefined ? { actorName: ctx.userName } : {}),
      });
      await auditFromContext(ctx, {
        action: 'collection.attachment.upload',
        status: 'ok',
        resourceType: 'collection_case',
        resourceId: id,
        detail: { fileName, sizeBytes: buffer.length, ...(row?.id ? { attachmentId: row.id } : {}) },
      });
      return reply.code(201).send({ attachment: row });
    },
  );

  /** A short-lived signed URL. The bytes never pass back through this API. */
  app.get<{ Params: { id: string; attId: string } }>(
    '/collection/cases/:id/attachments/:attId/download',
    auth,
    async (request) => {
      const { id, attId } = attachmentParams.parse(request.params);
      await requireCase(request, id);
      requireStorageConfigured();
      const attachment = await collectionCaseAttachmentRepo.getById(attId);
      // Check the parent as well as the id: an attachment id alone must not read across cases.
      if (!attachment || attachment.caseId !== id) throw new NotFoundError('Attachment not found');
      const { url, expiresAt } = await storageFor(attachment.storageProvider).presignGet(
        attachment.s3Key,
        { filename: attachment.fileName },
      );
      return { id: attachment.id, name: attachment.fileName, url, expiresAt };
    },
  );

  app.delete<{ Params: { id: string; attId: string } }>(
    '/collection/cases/:id/attachments/:attId',
    auth,
    async (request) => {
      const { id, attId } = attachmentParams.parse(request.params);
      const { ctx } = await requireCase(request, id);
      const attachment = await collectionCaseAttachmentRepo.getById(attId);
      if (!attachment || attachment.caseId !== id) throw new NotFoundError('Attachment not found');
      await collectionCaseAttachmentRepo.delete(attId);
      await auditFromContext(ctx, {
        action: 'collection.attachment.delete',
        status: 'ok',
        resourceType: 'collection_case',
        resourceId: id,
        detail: { attachmentId: attId, fileName: attachment.fileName },
      });
      // The object is left in the bucket on purpose: a row can be removed by mistake, and an
      // orphaned key costs storage where a deleted court filing costs a case.
      return { id: attId, deleted: true };
    },
  );
}
