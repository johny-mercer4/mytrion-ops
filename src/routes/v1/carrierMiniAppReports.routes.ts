import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  sendDocument,
  TelegramChatUnreachableError,
} from '../../integrations/telegramCarrierBot.js';
import { AppError } from '../../lib/errors.js';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import { buildCardLookupReport } from '../../modules/carrier/cardLookupReport.js';
import {
  requireRegisteredOwnerUser,
  telegramCtx,
  verifyTelegramUser,
} from '../../modules/carrier/miniAppAuth.js';

const cardLookupReportSchema = z.object({
  initData: z.string().min(1),
  format: z.enum(['pdf', 'xlsx']),
});

/** Owner/manager-only generated reports used by the Telegram carrier mini-app. */
export async function carrierMiniAppReportRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.post('/carrier/mini-app/card-lookup-report', async (request) => {
    const body = cardLookupReportSchema.parse(request.body);
    const { registration, carrierId } = await requireRegisteredOwnerUser(
      body.initData,
    );
    const { telegramUserId } = verifyTelegramUser(body.initData);
    const report = await buildCardLookupReport(
      carrierId,
      registration.companyName ?? 'Octane',
      body.format,
    );
    if (report.rows === 0) {
      throw new AppError('No cards found for this account.', {
        statusCode: 404,
        code: 'CARD_LOOKUP_EMPTY',
        expose: true,
      });
    }
    try {
      await sendDocument({
        chatId: registration.telegramChatId ?? telegramUserId,
        fileName: report.fileName,
        contentType: report.contentType,
        bytes: report.bytes,
        caption: `Octane · Card Lookup Report · ${body.format.toUpperCase()}`,
      });
    } catch (error) {
      if (error instanceof TelegramChatUnreachableError) {
        throw new AppError(
          'Open a chat with the Octane bot first, then try the download again.',
          {
            statusCode: 409,
            code: 'TELEGRAM_CHAT_UNREACHABLE',
            expose: true,
            cause: error,
          },
        );
      }
      throw new AppError("Couldn't send the card lookup report. Please try again.", {
        statusCode: 502,
        code: 'CARD_LOOKUP_REPORT_SEND_FAILED',
        expose: true,
        cause: error,
      });
    }
    await auditFromContext(
      telegramCtx(registration.profile, registration.telegramUserId),
      {
        action: 'carrier.mini_app.card_lookup_report_send',
        status: 'ok',
        resourceType: 'card_lookup_report',
        resourceId: carrierId,
        detail: {
          format: body.format,
          bytes: report.bytes.length,
          rows: report.rows,
        },
      },
    );
    return { sent: true, fileName: report.fileName, rows: report.rows };
  });
}
