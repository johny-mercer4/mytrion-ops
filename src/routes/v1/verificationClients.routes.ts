/**
 * Verification Mytrion → "Existing clients" (`GET /v1/verification/roster*`).
 *
 * Deliberately a different path from `/verification/clients` in `verificationPipeline.routes.ts` —
 * that endpoint is the SALES redesign's own tab (the caller's deal-clients + a mock pipeline stage);
 * this is the Verification Mytrion's company-wide roster and must not collide with it.
 *
 * Gated on the `verification` department (matches `access/mytrions.config.ts`'s Verification Mytrion),
 * not `sales` — a Verification reviewer and a sales agent are different audiences for different data.
 *
 * The roster itself is read-only (DWH). Carrier attachments are the one write path: metadata in
 * `carrier_attachments`, bytes in the Verification Dropbox root, keyed on carrier id.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import { maxFileBytes } from '../../modules/files/fileService.js';
import { carrierAttachmentService } from '../../modules/verification/carrierAttachmentService.js';
import {
  getVerificationClientDetail,
  listVerificationClients,
} from '../../modules/verification/verificationClients.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { requireDepartment } from './helpers.js';

function requireVerificationAccess(request: FastifyRequest): TenantContext {
  return requireDepartment(request, 'verification', 'Verification clients');
}

function dwhError(err: unknown): AppError {
  return new AppError('Data warehouse request failed', {
    statusCode: 502,
    code: 'DWH_ERROR',
    cause: err,
    expose: true,
  });
}

const carrierParams = z.object({ carrierId: z.string().min(1).max(64) });
/** Attachment routes require a numeric carrier id — that is `dim_company.carrier_id`. */
const attachmentCarrierParams = z.object({
  carrierId: z.string().regex(/^\d{1,20}$/, 'not a carrier id'),
});
const attachmentParams = attachmentCarrierParams.extend({
  attId: z.string().regex(/^cat_[a-z0-9]+$/, 'not an attachment id'),
});

export async function verificationClientsRoutes(app: FastifyInstance): Promise<void> {
  const auth = { onRequest: [app.authenticate] };

  // The full roster, creditworthy-first (see listVerificationClients). Fetched once and cached
  // client-side — see hrData.ts-style useCachedLoad on the frontend — so this is the only round
  // trip a session normally makes.
  app.get('/verification/roster', auth, async (request) => {
    requireVerificationAccess(request);
    try {
      const items = await listVerificationClients();
      return { items, total: items.length };
    } catch (err) {
      throw dwhError(err);
    }
  });

  // One carrier's identity/contact detail — fetched when a roster card's modal opens.
  app.get<{ Params: { carrierId: string } }>(
    '/verification/roster/:carrierId',
    auth,
    async (request) => {
      requireVerificationAccess(request);
      const { carrierId } = carrierParams.parse(request.params);
      try {
        const detail = await getVerificationClientDetail(carrierId);
        if (!detail) throw new NotFoundError('Carrier not found');
        return detail;
      } catch (err) {
        if (err instanceof NotFoundError) throw err;
        throw dwhError(err);
      }
    },
  );

  app.get<{ Params: { carrierId: string } }>(
    '/verification/roster/:carrierId/attachments',
    auth,
    async (request) => {
      const ctx = requireVerificationAccess(request);
      const { carrierId } = attachmentCarrierParams.parse(request.params);
      return { attachments: await carrierAttachmentService.list(ctx, carrierId) };
    },
  );

  app.post<{ Params: { carrierId: string } }>(
    '/verification/roster/:carrierId/attachments',
    auth,
    async (request, reply) => {
      const ctx = requireVerificationAccess(request);
      const { carrierId } = attachmentCarrierParams.parse(request.params);
      const part = await request.file({ limits: { fileSize: maxFileBytes() } });
      if (!part) throw new ValidationError('Expected a multipart file field');
      const buffer = await part.toBuffer();
      const attachment = await carrierAttachmentService.upload(ctx, carrierId, {
        fileName: part.filename || 'attachment',
        mime: part.mimetype || 'application/octet-stream',
        buffer,
      });
      await auditFromContext(ctx, {
        action: 'verification.carrier.attachment_upload',
        status: 'ok',
        resourceType: 'carrier',
        resourceId: carrierId,
        detail: { fileName: attachment.fileName, sizeBytes: attachment.sizeBytes, attachmentId: attachment.id },
      });
      return reply.code(201).send(attachment);
    },
  );

  app.get<{ Params: { carrierId: string; attId: string } }>(
    '/verification/roster/:carrierId/attachments/:attId/download',
    auth,
    async (request) => {
      const ctx = requireVerificationAccess(request);
      const { carrierId, attId } = attachmentParams.parse(request.params);
      return carrierAttachmentService.downloadUrl(ctx, carrierId, attId);
    },
  );

  /** Bytes through our origin — Telegram Mini App cannot fetch a cross-origin signed URL. */
  app.get<{ Params: { carrierId: string; attId: string } }>(
    '/verification/roster/:carrierId/attachments/:attId/bytes',
    auth,
    async (request, reply) => {
      const ctx = requireVerificationAccess(request);
      const { carrierId, attId } = attachmentParams.parse(request.params);
      const file = await carrierAttachmentService.getBytes(ctx, carrierId, attId);
      const safeName = file.fileName.replace(/[\r\n"]/g, '_');
      return reply
        .type(file.mime || 'application/octet-stream')
        .header('Content-Disposition', `attachment; filename="${safeName}"`)
        .send(file.buffer);
    },
  );

  app.delete<{ Params: { carrierId: string; attId: string } }>(
    '/verification/roster/:carrierId/attachments/:attId',
    auth,
    async (request) => {
      const ctx = requireVerificationAccess(request);
      const { carrierId, attId } = attachmentParams.parse(request.params);
      await carrierAttachmentService.remove(ctx, carrierId, attId);
      await auditFromContext(ctx, {
        action: 'verification.carrier.attachment_delete',
        status: 'ok',
        resourceType: 'carrier',
        resourceId: carrierId,
        detail: { attachmentId: attId },
      });
      return { id: attId, deleted: true };
    },
  );
}
