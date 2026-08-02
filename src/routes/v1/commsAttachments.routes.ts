/**
 * Chat attachments (/v1/comms/threads/:id/attachments) — the Dropbox-backed replacement for Zoho Desk's
 * Attachments tab.
 *
 * A file arrives as ONE bubble with its text: the upload appends a message and links the attachment to it,
 * rather than posting a file and a comment separately the way the Desk path had to. That is what makes
 * `is_internal` correct by construction — the attachment inherits it from the parent message, so a file on
 * an internal note cannot become visible on its own.
 *
 * Bytes go through the normal `fileService` pipeline (so RBAC, audit and the size cap are unchanged) with
 * the provider pinned to `COMMS_STORAGE_PROVIDER`. The provider is recorded on the file row, so existing
 * S3 files keep resolving to S3 and only new chat files land on Dropbox.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { AppError, NotFoundError, RBACError } from '../../lib/errors.js';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import { readerOf, toMessageDto } from '../../modules/comms/dto.js';
import { publishSafely, publishThreadEvent } from '../../modules/comms/publish.js';
import { storeFile } from '../../modules/files/fileService.js';
import { commsStorageProvider, storageFor } from '../../modules/files/storage/index.js';
import { commsAttachmentRepo } from '../../repos/commsAttachmentRepo.js';
import { commsMessageRepo } from '../../repos/commsMessageRepo.js';
import { commsThreadMemberRepo } from '../../repos/commsThreadMemberRepo.js';
import { commsThreadRepo } from '../../repos/commsThreadRepo.js';
import { fileRepo } from '../../repos/fileRepo.js';
import type { MytrionThreadAttachment } from '../../db/schema/index.js';
import { requireInternal } from './helpers.js';

function attachmentMaxBytes(): number {
  return env.COMMS_ATTACHMENT_MAX_MB * 1024 * 1024;
}

interface UploadPart {
  name: string;
  mime: string;
  buffer: Buffer;
}

/**
 * Collect one file plus text fields from a multipart body.
 *
 * `request.parts()` rather than `request.file()`: `file()` consumes the stream at the first file part, so any
 * field sent AFTER the file is lost — a field-ordering trap the files route already documents. Iterating
 * parts makes order irrelevant.
 */
async function readUpload(
  request: FastifyRequest,
): Promise<{ fields: Record<string, string>; file: UploadPart | null }> {
  const fields: Record<string, string> = {};
  let file: UploadPart | null = null;
  try {
    for await (const part of request.parts({
      limits: { fileSize: attachmentMaxBytes(), files: 1 },
    })) {
      if (part.type === 'file') {
        const buffer = await part.toBuffer();
        file = {
          name: part.filename || 'attachment',
          mime: part.mimetype || 'application/octet-stream',
          buffer,
        };
      } else {
        fields[part.fieldname] =
          typeof part.value === 'string' ? part.value : String(part.value ?? '');
      }
    }
  } catch (err) {
    // Fastify throws past the limit; surface the clean 413 rather than a raw 500.
    if (err instanceof Error && /file too large|FST_REQ_FILE_TOO_LARGE/i.test(err.message)) {
      throw new AppError(`Attachment exceeds the ${env.COMMS_ATTACHMENT_MAX_MB}MB limit.`, {
        statusCode: 413,
        code: 'ATTACHMENT_TOO_LARGE',
        expose: true,
      });
    }
    throw err;
  }
  return { fields, file };
}

const uploadFields = z.object({
  /** Optional caption. Absent → the message body is the filename, so the bubble is never blank. */
  body: z.string().max(8000).optional(),
  isInternal: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  clientMsgId: z.string().max(120).optional(),
});

function toAttachmentDto(row: MytrionThreadAttachment): Record<string, unknown> {
  return {
    id: row.id,
    messageId: row.messageId,
    name: row.name,
    mime: row.mime,
    sizeBytes: row.sizeBytes,
    storage: row.storage,
    isInternal: row.isInternal,
    uploadedBy: row.uploadedByZohoUserId,
    createdAt: row.createdAt.toISOString(),
    /**
     * No URL here on purpose. A Dropbox link is a network round trip per file and expires in ~4h, so a list
     * that embedded one would be slow and would hand out links that die in a tab left open. Clients call
     * the link endpoint when the user actually clicks.
     */
  };
}

export async function commsAttachmentsRoutes(app: FastifyInstance): Promise<void> {
  const guard = { onRequest: [app.sessionOrApiKey] };

  /** Upload a file into a conversation as one message-with-attachment (write — audited). */
  app.post('/comms/threads/:id/attachments', guard, async (request, reply) => {
    const ctx = requireInternal(request, 'Comms attachments');
    const { id } = request.params as { id: string };

    const thread = await commsThreadRepo.getForReader(ctx, id);
    if (!thread) throw new NotFoundError('Conversation not found.');

    const reader = readerOf(ctx);
    if (!reader.actorZohoUserId) {
      throw new RBACError('Uploading requires a signed-in worker identity.');
    }

    const { fields, file } = await readUpload(request);
    if (!file) throw new AppError('No file in the request.', { statusCode: 400, code: 'NO_FILE', expose: true });
    const f = uploadFields.parse(fields);

    // The bytes first: if storage fails there must be no message claiming a file that does not exist.
    const stored = await storeFile(ctx, {
      buffer: file.buffer,
      name: file.name,
      mime: file.mime,
      kind: 'upload',
      createdBy: 'comms.attachment',
      storageProvider: commsStorageProvider(),
      ...(thread.department ? { department: thread.department } : {}),
    });

    const message = await commsMessageRepo.append(ctx, {
      threadId: thread.id,
      // A blank bubble reads as a bug; the filename is the honest default caption.
      body: f.body?.trim() || file.name,
      kind: f.isInternal ? 'note' : 'message',
      authorKind: 'worker',
      authorZohoUserId: reader.actorZohoUserId,
      authorName: ctx.userName ?? reader.actorZohoUserId,
      isInternal: f.isInternal,
    });

    const attachment = await commsAttachmentRepo.add(ctx, {
      threadId: thread.id,
      messageId: message.id,
      fileAssetId: stored.fileId,
      storage: commsStorageProvider(),
      name: stored.name,
      mime: stored.mime,
      sizeBytes: stored.sizeBytes,
      // Inherited from the message, never taken from the request separately.
      isInternal: f.isInternal,
      uploadedByZohoUserId: reader.actorZohoUserId,
    });

    await commsThreadMemberRepo.ensureWatcher(ctx, thread.id, {
      memberKind: 'worker',
      memberKey: reader.actorZohoUserId,
      memberName: ctx.userName ?? null,
    });
    const members = await commsThreadMemberRepo.listByThread(ctx, thread.id);

    await auditFromContext(ctx, {
      action: 'comms.thread.attachment',
      status: 'ok',
      resourceType: 'comms_thread',
      resourceId: thread.id,
      detail: {
        attachmentId: attachment.id,
        fileId: stored.fileId,
        name: stored.name,
        sizeBytes: stored.sizeBytes,
        storage: attachment.storage,
        isInternal: f.isInternal,
      },
    });

    publishSafely('comms.thread.attachment', () => {
      publishThreadEvent(
        { id: thread.id, department: thread.department },
        members,
        {
          type: 'comms.thread.attachment',
          threadId: thread.id,
          seq: message.seq,
          clientMsgId: f.clientMsgId ?? null,
          messageId: message.id,
          attachmentId: attachment.id,
          name: attachment.name,
          sizeBytes: attachment.sizeBytes,
          isInternal: attachment.isInternal,
        },
        { excludeMemberKey: reader.actorZohoUserId },
      );
    });

    return reply.code(201).send({
      message: toMessageDto(message, reader),
      attachment: toAttachmentDto(attachment),
    });
  });

  /** Every file in a conversation. Internal-note files are filtered in SQL for a carrier reader. */
  app.get('/comms/threads/:id/attachments', guard, async (request) => {
    const ctx = requireInternal(request, 'Comms attachments');
    const { id } = request.params as { id: string };
    const thread = await commsThreadRepo.getForReader(ctx, id);
    if (!thread) throw new NotFoundError('Conversation not found.');

    const reader = readerOf(ctx);
    const rows = await commsAttachmentRepo.listByThread(ctx, id, {
      ...(reader.isCustomer ? { excludeInternal: true } : {}),
    });
    return { attachments: rows.map(toAttachmentDto) };
  });

  /**
   * A time-limited download URL for one attachment.
   *
   * Resolved on demand rather than embedded in the list: a Dropbox link costs a round trip and expires in
   * ~4 hours, so pre-generating one per row would be both slow and short-lived. The link is produced through
   * the FILE ROW's own provider, so an old S3 attachment and a new Dropbox one both work.
   */
  app.get('/comms/threads/:threadId/attachments/:id/link', guard, async (request) => {
    const ctx = requireInternal(request, 'Comms attachments');
    const { threadId, id } = request.params as { threadId: string; id: string };

    // Thread first: the gate is the thread, and an attachment id alone must never resolve to bytes.
    const thread = await commsThreadRepo.getForReader(ctx, threadId);
    if (!thread) throw new NotFoundError('Conversation not found.');

    const attachment = await commsAttachmentRepo.getInThread(ctx, threadId, id);
    if (!attachment) throw new NotFoundError('Attachment not found.');

    const reader = readerOf(ctx);
    if (attachment.isInternal && reader.isCustomer) throw new NotFoundError('Attachment not found.');

    const asset = await fileRepo.findVisible(ctx, attachment.fileAssetId);
    if (!asset) throw new NotFoundError('The stored file is no longer available.');

    const link = await storageFor(asset.storageProvider).presignGet(asset.s3Key, {
      filename: asset.name,
    });
    return {
      url: link.url,
      expiresAt: link.expiresAt.toISOString(),
      name: asset.name,
      mime: asset.mime,
      sizeBytes: asset.sizeBytes,
      storage: asset.storageProvider,
    };
  });
}
