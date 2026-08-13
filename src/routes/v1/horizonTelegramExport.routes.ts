/**
 * POST /horizon/telegram/export-send — Mini App export → Horizon bot sendDocument.
 *
 * Auth is the Zoho Bearer session. Bytes go to the worker's linked private chat using
 * HORIZON_BOT_TOKEN only. Desktop CRM downloads never hit this route.
 */
import type { FastifyInstance } from 'fastify';
import { env } from '../../config/env.js';
import { AppError, ValidationError } from '../../lib/errors.js';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import {
  HORIZON_EXPORT_MAX_BYTES,
  sendHorizonDocumentToLinkedWorker,
} from '../../modules/horizon/sendHorizonDocument.js';
import { zohoUserIdFromContext } from '../../modules/horizon/telegramLink.js';
import { requireContext } from './helpers.js';

export async function horizonTelegramExportRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/horizon/telegram/export-send',
    { onRequest: [app.authenticate] },
    async (request) => {
      if (!env.HORIZON_BOT_TOKEN) {
        throw new AppError('Horizon bot is not configured', {
          statusCode: 503,
          code: 'HORIZON_BOT_UNCONFIGURED',
        });
      }

      const ctx = requireContext(request);
      zohoUserIdFromContext(ctx);
      const part = await request.file({ limits: { fileSize: HORIZON_EXPORT_MAX_BYTES } });
      if (!part) {
        throw new ValidationError('Expected a multipart file field named "file".');
      }

      let buffer: Buffer;
      try {
        buffer = await part.toBuffer();
      } catch (e) {
        if ((e as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') {
          throw new AppError(
            `That file is larger than ${Math.round(HORIZON_EXPORT_MAX_BYTES / 1_000_000)} MB.`,
            { statusCode: 413, code: 'HORIZON_EXPORT_TOO_LARGE', expose: true },
          );
        }
        throw e;
      }

      const sent = await sendHorizonDocumentToLinkedWorker(ctx, {
        bytes: new Uint8Array(buffer),
        filename: part.filename || 'export.bin',
        mimeType: part.mimetype || 'application/octet-stream',
      });

      await auditFromContext(ctx, {
        action: 'horizon.telegram.export_send',
        status: 'ok',
        resourceType: 'horizon_worker_telegram_link',
        resourceId: sent.telegramUserId,
        detail: {
          filename: sent.filename,
          bytes: buffer.byteLength,
        },
      });

      return { ok: true as const, sent: true as const, filename: sent.filename };
    },
  );
}
