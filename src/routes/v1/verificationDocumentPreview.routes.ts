/**
 * INLINE PREVIEW of an applicant document — the same bytes, both desks, served from our origin.
 *
 * WHY THIS EXISTS. The `…/download` routes hand out Dropbox's `get_temporary_link`. Dropbox serves
 * that link with `Content-Disposition: attachment` and no CORS headers, so clicking a bank statement
 * opened a blank tab and downloaded the file: an underwriter could not LOOK at the document they were
 * underwriting, and a Sales agent could not check what they had uploaded. The Dropbox adapter's own
 * note on `presignGet` says a caller that needs a Content-Disposition must proxy the bytes instead.
 *
 * WHY A SEPARATE FILE. Two reasons, and neither is taste. The pair belongs together — one shape, two
 * department gates, and a change to the headers must land on both — and `verificationFlow.routes.ts`
 * sits at 592 lines against the 600-line cap, so the desk half cannot go where its sibling lives.
 *
 * WHY NOT A `?token=` URL, which WOULD let a plain `<a href>` reach these bytes. That mechanism does
 * exist in this codebase — `realtime.routes.ts`'s `liftTokenFromQuery` — and it is deliberately
 * confined to the WebSocket handshake, because a handshake is the one request a browser cannot put a
 * header on. A GET can. Spreading the carve-out here would put a session token into browser history,
 * the `Referer` header and every access log in front of the app, in exchange for a link to a bank
 * statement. The client fetches these routes with the session bearer and renders the result from a
 * `blob:` URL instead — same-origin to the CRM document, so the browser's own viewer handles it.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import { documentService } from '../../modules/verificationFlow/documentService.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { requireDepartment } from './helpers.js';

const docParams = z.object({ id: z.string().min(1), documentId: z.string().min(1) });

/** Sales reaches its own application; Verification reaches the case it underwrites. Same document. */
function requireSales(request: FastifyRequest): TenantContext {
  return requireDepartment(request, 'sales', 'Verification applications');
}
function requireVerificationRead(request: FastifyRequest): TenantContext {
  return requireDepartment(request, 'verification', 'Verification underwriting');
}

/**
 * `inline`, and the row's real MIME.
 *
 * `X-Content-Type-Options: nosniff` is set globally, so a wrong or missing content type renders as a
 * blank frame rather than as a PDF. `no-store` because these are bank statements and identity
 * documents: they must not sit in a shared HTTP cache.
 */
async function sendInline(
  reply: FastifyReply,
  file: { fileName: string; mime: string; buffer: Buffer },
): Promise<unknown> {
  const safeName = file.fileName.replace(/[\r\n"]/g, '_');
  return reply
    .type(file.mime)
    .header('Content-Disposition', `inline; filename="${safeName}"`)
    .header('Cache-Control', 'no-store')
    .send(file.buffer);
}

export async function verificationDocumentPreviewRoutes(app: FastifyInstance): Promise<void> {
  const auth = { onRequest: [app.authenticate] };

  /** Sales, on its own application. */
  app.get<{ Params: { id: string; documentId: string } }>(
    '/verification/applications/:id/documents/:documentId/bytes',
    auth,
    async (request, reply) => {
      const ctx = requireSales(request);
      const { id, documentId } = docParams.parse(request.params);
      const file = await documentService.getBytes(ctx, id, documentId);
      return sendInline(reply, file);
    },
  );

  /**
   * The desk, on the case it is underwriting. READ-gated, not write: reading a bank statement IS the
   * underwriting job. Audited like its `…/download` sibling — who looked at an applicant's identity
   * documents is exactly the kind of access worth a trail.
   */
  app.get<{ Params: { id: string; documentId: string } }>(
    '/verification/flow/cases/:id/documents/:documentId/bytes',
    auth,
    async (request, reply) => {
      const ctx = requireVerificationRead(request);
      const { id, documentId } = docParams.parse(request.params);
      const file = await documentService.getBytes(ctx, id, documentId);
      await auditFromContext(ctx, {
        action: 'verification.flow.document_previewed',
        status: 'ok',
        resourceType: 'verification_case',
        resourceId: id,
        detail: { documentId, fileName: file.fileName },
      });
      return sendInline(reply, file);
    },
  );
}
