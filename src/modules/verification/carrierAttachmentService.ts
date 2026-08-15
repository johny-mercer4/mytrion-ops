/**
 * Existing-client attachments — bytes to the Verification Dropbox root, metadata to
 * `carrier_attachments`, keyed on carrier id (never a verification case).
 *
 * Key layout is walkable without this app: `<tenant>/carriers/<carrierId>/<id>-<filename>`.
 * That prefix is what makes "tied to the carrier id at creation" true in storage as well as
 * in Postgres. The provider is stamped ON THE ROW, never read from env at download time.
 */
import { createId } from '@paralleldrive/cuid2';
import { databaseHost, env } from '../../config/env.js';
import type { CarrierAttachment } from '../../db/schema/index.js';
import { AppError, NotFoundError } from '../../lib/errors.js';
import { carrierAttachmentRepo } from '../../repos/carrierAttachmentRepo.js';
import { isMissingTable } from '../../repos/util.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { maxFileBytes } from '../files/fileService.js';
import { storageFor, verificationStorageProvider } from '../files/storage/index.js';
import type { VerificationStorageProvider } from '../../db/schema/verification_flow.js';

export interface CarrierAttachmentDto {
  id: string;
  carrierId: string;
  fileName: string;
  mime: string;
  sizeBytes: number;
  uploadedByName: string | null;
  createdAt: string;
}

export interface UploadCarrierAttachmentInput {
  fileName: string;
  mime: string;
  buffer: Buffer;
}

/** Strip anything that could climb a path or confuse Dropbox / Content-Disposition. */
export function sanitizeCarrierAttachmentName(name: string): string {
  const printable = Array.from(name)
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code > 0x1f && code !== 0x7f;
    })
    .join('');
  return printable.replace(/[\\/]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 180) || 'file';
}

/** Storage key. The Dropbox adapter prefixes `DROPBOX_VERIFICATION_ROOT_PATH` (`/verification`). */
export function carrierAttachmentStorageKey(input: {
  tenantId: string;
  carrierId: string;
  attachmentId: string;
  fileName: string;
}): string {
  return `${input.tenantId}/carriers/${input.carrierId}/${input.attachmentId}-${sanitizeCarrierAttachmentName(input.fileName)}`;
}

export function toCarrierAttachmentDto(row: CarrierAttachment): CarrierAttachmentDto {
  return {
    id: row.id,
    carrierId: row.carrierId,
    fileName: row.fileName,
    mime: row.mime,
    sizeBytes: row.sizeBytes,
    uploadedByName: row.uploadedByName,
    createdAt: row.createdAt.toISOString(),
  };
}

function notMigratedMessage(): string {
  return (
    `Carrier attachments are not on this database (${databaseHost()}) yet. ` +
    'Start the API with `pnpm dev:local-db` (or USE_LOCAL_OPS_DB=1 pnpm dev:all) to use local Docker Postgres, ' +
    'or run `pnpm db:migrate` on the database this process uses. ' +
    'Do not migrate a remote/prod URL unless you have opted in.'
  );
}

function withSchemaGuard<T>(fn: () => Promise<T>): Promise<T> {
  return fn().catch((err: unknown) => {
    if (isMissingTable(err, 'carrier_attachments')) {
      throw new AppError(notMigratedMessage(), {
        statusCode: 503,
        code: 'CARRIER_ATTACHMENTS_UNMIGRATED',
        expose: true,
      });
    }
    throw err;
  });
}

/**
 * Checks the provider a NEW upload would use. A Dropbox-configured env still has leftover S3
 * creds; a stale S3 credential must not block uploads once Dropbox is the live path.
 */
export function requireCarrierAttachmentStorage(): void {
  if (verificationStorageProvider() === 'dropbox_verification') {
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

export const carrierAttachmentService = {
  async list(ctx: TenantContext, carrierId: string): Promise<CarrierAttachmentDto[]> {
    return withSchemaGuard(async () => {
      const rows = await carrierAttachmentRepo.listByCarrier(ctx, carrierId);
      return rows.map(toCarrierAttachmentDto);
    });
  },

  async upload(
    ctx: TenantContext,
    carrierId: string,
    input: UploadCarrierAttachmentInput,
  ): Promise<CarrierAttachmentDto> {
    requireCarrierAttachmentStorage();
    return withSchemaGuard(async () => {
      if (input.buffer.length === 0) {
        throw new AppError('Refusing to store an empty file', {
          statusCode: 400,
          code: 'EMPTY_FILE',
          expose: true,
        });
      }
      if (input.buffer.length > maxFileBytes()) {
        throw new AppError(`File exceeds the ${env.FILE_MAX_SIZE_MB}MB limit`, {
          statusCode: 413,
          code: 'FILE_TOO_LARGE',
          expose: true,
        });
      }

      const provider: VerificationStorageProvider = verificationStorageProvider();
      const id = `cat_${createId()}`;
      const fileName = sanitizeCarrierAttachmentName(input.fileName);
      const mime = input.mime || 'application/octet-stream';
      const key = carrierAttachmentStorageKey({
        tenantId: ctx.tenantId,
        carrierId,
        attachmentId: id,
        fileName,
      });

      // Bytes first: a storage failure must not leave a metadata row pointing at nothing.
      await storageFor(provider).put(key, input.buffer, { contentType: mime });

      const row = await carrierAttachmentRepo.insert(ctx, {
        id,
        carrierId,
        fileName,
        mime,
        sizeBytes: input.buffer.length,
        s3Key: key,
        storageProvider: provider,
        uploadedByUserId: ctx.userId,
        ...(ctx.userName !== undefined ? { uploadedByName: ctx.userName } : {}),
      });
      return toCarrierAttachmentDto(row);
    });
  },

  async downloadUrl(
    ctx: TenantContext,
    carrierId: string,
    attachmentId: string,
  ): Promise<{ id: string; name: string; url: string; expiresAt?: Date | undefined }> {
    requireCarrierAttachmentStorage();
    return withSchemaGuard(async () => {
      const row = await carrierAttachmentRepo.find(ctx, carrierId, attachmentId);
      if (!row) throw new NotFoundError('Attachment not found');
      const link = await storageFor(row.storageProvider).presignGet(row.s3Key, {
        filename: row.fileName,
      });
      return {
        id: row.id,
        name: row.fileName,
        url: link.url,
        ...(link.expiresAt !== undefined ? { expiresAt: link.expiresAt } : {}),
      };
    });
  },

  async getBytes(
    ctx: TenantContext,
    carrierId: string,
    attachmentId: string,
  ): Promise<{ fileName: string; mime: string; buffer: Buffer }> {
    requireCarrierAttachmentStorage();
    return withSchemaGuard(async () => {
      const row = await carrierAttachmentRepo.find(ctx, carrierId, attachmentId);
      if (!row) throw new NotFoundError('Attachment not found');
      const buffer = await storageFor(row.storageProvider).getBuffer(row.s3Key, maxFileBytes());
      return { fileName: row.fileName, mime: row.mime, buffer };
    });
  },

  /**
   * Metadata first, then bytes: an orphaned object costs storage, whereas an orphaned ROW is a
   * broken download the desk cannot explain. A storage failure after the row is gone is swallowed.
   */
  async remove(ctx: TenantContext, carrierId: string, attachmentId: string): Promise<void> {
    requireCarrierAttachmentStorage();
    return withSchemaGuard(async () => {
      const row = await carrierAttachmentRepo.find(ctx, carrierId, attachmentId);
      if (!row) throw new NotFoundError('Attachment not found');
      await carrierAttachmentRepo.delete(ctx, carrierId, attachmentId);
      try {
        await storageFor(row.storageProvider).delete(row.s3Key);
      } catch {
        // Intentionally swallowed — the user's intent (make it disappear) already succeeded.
      }
    });
  },
};
