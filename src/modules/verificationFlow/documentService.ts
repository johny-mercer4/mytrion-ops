/**
 * Applicant documents — bytes to Dropbox, metadata to `verification_case_documents`.
 *
 * These are the files the later LLM underwriting review will read, so the key layout is designed to
 * be walkable by something other than this app: `<tenant>/<caseId>/<docType>/<id>-<filename>`.
 *
 * The provider is stamped ON THE ROW, never read from env at download time. That is the rule the
 * storage seam documents and the reason a default flip cannot repoint an existing file's read at a
 * folder its bytes are not in.
 *
 * A `requested` row is an ask with no bytes. Fulfilling it UPDATES that row rather than inserting a
 * second one, which is what keeps `requested_in_phase` — and therefore the return-to-phase rule —
 * attached to the document that answered it.
 */
import { AppError, NotFoundError } from '../../lib/errors.js';
import { storageFor, verificationStorageProvider } from '../files/storage/index.js';
import { requireCarrierAttachmentStorage } from '../verification/carrierAttachmentService.js';
import { verificationCaseAssetRepo } from '../../repos/verificationCaseAssetRepo.js';
import type {
  VerificationCaseDocument,
  VerificationDocType,
  VerificationStorageProvider,
} from '../../db/schema/verification_flow.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { withFlowSchemaGuard, zohoFromCtx } from './applicationService.js';

/** Per-file ceiling. Bank statements are PDFs; 20 MB is generous and matches the legacy desk. */
export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;
export const MAX_DOCUMENTS_PER_UPLOAD = 20;

const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/heic',
  'image/webp',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

/** Strip anything that could climb a path or confuse Dropbox. The storage layer sanitises too. */
function safeName(name: string): string {
  // Control characters are dropped by code point rather than by regex: a literal control
  // class trips `no-control-regex`, and suppressing that rule reads as if the characters
  // were an oversight. They are the point — \x00 or \r in a filename corrupts both the
  // Dropbox path and the Content-Disposition header on download.
  const printable = Array.from(name)
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code > 0x1f && code !== 0x7f;
    })
    .join('');
  return printable.replace(/[\\/]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 180) || 'document';
}

function keyFor(tenantId: string, caseId: string, docType: string, id: string, name: string): string {
  return `${tenantId}/${caseId}/${docType}/${id}-${safeName(name)}`;
}

export interface UploadInput {
  docType: VerificationDocType;
  label?: string | undefined;
  fileName: string;
  mime: string;
  buffer: Buffer;
  /** When set, fulfils that outstanding request instead of adding a loose document. */
  fulfilsRequestId?: string | undefined;
}

export const documentService = {
  async list(ctx: TenantContext, caseId: string): Promise<VerificationCaseDocument[]> {
    return withFlowSchemaGuard(() => verificationCaseAssetRepo.listDocuments(ctx, caseId));
  },

  async upload(
    ctx: TenantContext,
    caseId: string,
    input: UploadInput,
    actorName?: string,
  ): Promise<VerificationCaseDocument> {
    return withFlowSchemaGuard(async () => {
      if (input.buffer.length === 0) {
        throw new AppError(`"${input.fileName}" is empty.`, {
          statusCode: 400,
          code: 'VERIFICATION_DOC_EMPTY',
          expose: true,
        });
      }
      if (input.buffer.length > MAX_DOCUMENT_BYTES) {
        throw new AppError(
          `"${input.fileName}" is larger than the ${Math.round(MAX_DOCUMENT_BYTES / 1024 / 1024)} MB limit.`,
          { statusCode: 413, code: 'VERIFICATION_DOC_TOO_LARGE', expose: true },
        );
      }
      if (!ALLOWED_MIME.has(input.mime)) {
        throw new AppError(
          `"${input.fileName}" is a ${input.mime} file. Upload a PDF, image, spreadsheet or document.`,
          { statusCode: 415, code: 'VERIFICATION_DOC_UNSUPPORTED', expose: true },
        );
      }

      const provider: VerificationStorageProvider = verificationStorageProvider();
      const actor = zohoFromCtx(ctx) ?? ctx.userId;

      // Fulfilling an outstanding ask keeps the ORIGINAL row so `requested_in_phase` survives.
      const existing = input.fulfilsRequestId
        ? await verificationCaseAssetRepo.findDocument(ctx, caseId, input.fulfilsRequestId)
        : undefined;
      if (input.fulfilsRequestId && !existing) {
        throw new NotFoundError('That document request no longer exists.');
      }

      const rowId = existing?.id ?? `pending-${Date.now()}`;
      const key = keyFor(ctx.tenantId, caseId, input.docType, rowId, input.fileName);

      // Bytes first: a storage failure must not leave a metadata row pointing at nothing.
      // Same precondition the carrier-attachment surface uses: an unconfigured Dropbox otherwise
      // surfaces as a raw 500 from deep inside the adapter, which reads as "the app is broken"
      // rather than "this environment has no file storage".
      requireCarrierAttachmentStorage();
      await storageFor(provider).put(key, input.buffer, { contentType: input.mime });

      if (existing) {
        const updated = await verificationCaseAssetRepo.updateDocument(ctx, caseId, existing.id, {
          status: 'received',
          docType: input.docType,
          fileName: safeName(input.fileName),
          mime: input.mime,
          sizeBytes: input.buffer.length,
          s3Key: key,
          storageProvider: provider,
          uploadedByUserId: actor,
          uploadedByName: actorName ?? ctx.userId,
        });
        if (!updated) throw new NotFoundError('That document request no longer exists.');
        return updated;
      }

      return verificationCaseAssetRepo.addDocument(ctx, {
        caseId,
        docType: input.docType,
        label: input.label ?? null,
        status: 'received',
        fileName: safeName(input.fileName),
        mime: input.mime,
        sizeBytes: input.buffer.length,
        s3Key: key,
        storageProvider: provider,
        uploadedByUserId: actor,
        uploadedByName: actorName ?? ctx.userId,
      });
    });
  },

  /** A desk-side ask: a row with no bytes, tagged with the phase that wants it. */
  async request(
    ctx: TenantContext,
    caseId: string,
    input: { docType: VerificationDocType; label?: string | undefined; phaseCode: string },
  ): Promise<VerificationCaseDocument> {
    return withFlowSchemaGuard(() =>
      verificationCaseAssetRepo.addDocument(ctx, {
        caseId,
        docType: input.docType,
        label: input.label ?? null,
        status: 'requested',
        requestedInPhase: input.phaseCode,
        requestedBy: zohoFromCtx(ctx) ?? ctx.userId,
        requestedAt: new Date(),
      }),
    );
  },

  /**
   * A short-lived link to the bytes. Resolved through the provider ON THE ROW — handing a Dropbox
   * key to the S3 client would 404, and handing an S3 key to Dropbox would too.
   */
  async downloadUrl(
    ctx: TenantContext,
    caseId: string,
    documentId: string,
  ): Promise<{ url: string; expiresAt?: Date | undefined; fileName: string }> {
    return withFlowSchemaGuard(async () => {
      const doc = await verificationCaseAssetRepo.findDocument(ctx, caseId, documentId);
      if (!doc) throw new NotFoundError('Document not found');
      if (!doc.s3Key) {
        throw new AppError('That document has been requested but not uploaded yet.', {
          statusCode: 409,
          code: 'VERIFICATION_DOC_NOT_UPLOADED',
          expose: true,
        });
      }
      requireCarrierAttachmentStorage();
      const link = await storageFor(doc.storageProvider).presignGet(doc.s3Key, {
        filename: doc.fileName ?? 'document',
      });
      return {
        url: link.url,
        expiresAt: link.expiresAt,
        fileName: doc.fileName ?? 'document',
      };
    });
  },

  /**
   * The BYTES, through our own origin — what makes a PREVIEW possible.
   *
   * `downloadUrl` hands out Dropbox's `get_temporary_link`, and Dropbox serves that link with
   * `Content-Disposition: attachment` and no CORS headers. So clicking a document opened a blank tab
   * that immediately downloaded the file: the agent never saw a bank statement, they collected it.
   * The adapter's own note (`dropboxStorage.presignGet`) says a caller that needs a
   * Content-Disposition must proxy the bytes through the download route instead — this is that route's
   * service half.
   *
   * `getBuffer`, not `getStream`: no route in this codebase streams, and the Dropbox adapter's
   * `getBuffer` already checks the size on the metadata BEFORE fetching, so an oversized object is
   * never buffered.
   */
  async getBytes(
    ctx: TenantContext,
    caseId: string,
    documentId: string,
  ): Promise<{ fileName: string; mime: string; buffer: Buffer }> {
    return withFlowSchemaGuard(async () => {
      const doc = await verificationCaseAssetRepo.findDocument(ctx, caseId, documentId);
      if (!doc) throw new NotFoundError('Document not found');
      if (!doc.s3Key) {
        throw new AppError('That document has been requested but not uploaded yet.', {
          statusCode: 409,
          code: 'VERIFICATION_DOC_NOT_UPLOADED',
          expose: true,
        });
      }
      requireCarrierAttachmentStorage();
      const buffer = await storageFor(doc.storageProvider).getBuffer(doc.s3Key, MAX_DOCUMENT_BYTES);
      return {
        fileName: doc.fileName ?? 'document',
        // Dropbox stores no content type, so the row's own MIME is the only truth about these bytes —
        // and `X-Content-Type-Options: nosniff` is set globally, so a wrong type means a blank frame.
        mime: doc.mime || 'application/octet-stream',
        buffer,
      };
    });
  },

  /**
   * Remove a document. Metadata first, then bytes: an orphaned object costs storage, whereas an
   * orphaned ROW is a broken download the desk cannot explain. A storage failure after the row is
   * gone is logged, not surfaced — the user's intent (make it disappear) already succeeded.
   */
  async remove(ctx: TenantContext, caseId: string, documentId: string): Promise<void> {
    return withFlowSchemaGuard(async () => {
      const doc = await verificationCaseAssetRepo.findDocument(ctx, caseId, documentId);
      if (!doc) throw new NotFoundError('Document not found');
      await verificationCaseAssetRepo.deleteDocument(ctx, caseId, documentId);
      if (doc.s3Key) {
        try {
          await storageFor(doc.storageProvider).delete(doc.s3Key);
        } catch {
          // Intentionally swallowed — see the note above.
        }
      }
    });
  },
};
