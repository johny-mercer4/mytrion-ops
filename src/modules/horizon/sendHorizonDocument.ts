/**
 * Send a Mini App export to the Zoho worker's linked Horizon bot chat.
 *
 * Lookup is tenant-scoped via horizonWorkerTelegramRepo. Bytes go out on HORIZON_BOT_TOKEN only.
 */
import {
  HorizonTelegramChatUnreachableError,
  sendHorizonDocument,
} from '../../integrations/telegramHorizonBot.js';
import { AppError, ConflictError, RBACError } from '../../lib/errors.js';
import { horizonWorkerTelegramRepo } from '../../repos/horizonWorkerTelegramRepo.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { zohoUserIdFromContext } from './telegramLink.js';

/** Telegram Bot API sendDocument cap is 50 MB; stay under the global multipart floor too. */
export const HORIZON_EXPORT_MAX_BYTES = 20_000_000;

export function safeHorizonExportFileName(name: string): string {
  const base = name.replace(/\\/g, '/').split('/').pop()?.trim() || 'export.bin';
  const cleaned = base.replace(/[^\w.\- ()[\]]+/g, '_').replace(/^\.+/, '');
  return (cleaned || 'export.bin').slice(0, 200);
}

export function mimeTypeForExport(fileName: string, fallback: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'xlsx') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (ext === 'xls') return 'application/vnd.ms-excel';
  if (ext === 'csv') return 'text/csv';
  if (ext === 'txt') return 'text/plain';
  if (fallback && fallback !== 'application/octet-stream') return fallback;
  return 'application/octet-stream';
}

export interface SendHorizonDocumentInput {
  bytes: Uint8Array;
  filename: string;
  mimeType: string;
}

export interface SendHorizonDocumentResult {
  chatId: string;
  telegramUserId: string;
  filename: string;
}

function unlinkedError(): ConflictError {
  return new ConflictError(
    'Telegram is not linked. Open the Mini App after Zoho login to link your Horizon bot chat.',
    { code: 'TELEGRAM_CHAT_UNLINKED' },
  );
}

/**
 * Resolve the caller's Horizon private chat from horizon_worker_telegram_links and sendDocument.
 * Auth identity is the Zoho Bearer session (ctx), never a client-supplied zoho/telegram id.
 */
export async function sendHorizonDocumentToLinkedWorker(
  ctx: TenantContext,
  input: SendHorizonDocumentInput,
): Promise<SendHorizonDocumentResult> {
  if (ctx.audience !== 'internal') {
    throw new RBACError('Horizon file delivery is internal-only');
  }
  const zohoUserId = zohoUserIdFromContext(ctx);
  const filename = safeHorizonExportFileName(input.filename);
  const mimeType = mimeTypeForExport(filename, input.mimeType);
  if (input.bytes.byteLength === 0) {
    throw new AppError('That file is empty.', { statusCode: 400, code: 'EMPTY_FILE', expose: true });
  }
  if (input.bytes.byteLength > HORIZON_EXPORT_MAX_BYTES) {
    throw new AppError(
      `That file is larger than ${Math.round(HORIZON_EXPORT_MAX_BYTES / 1_000_000)} MB.`,
      { statusCode: 413, code: 'HORIZON_EXPORT_TOO_LARGE', expose: true },
    );
  }

  const row = await horizonWorkerTelegramRepo.findByZohoUserId(ctx, zohoUserId);
  if (!row || row.status !== 'active') throw unlinkedError();
  const chatId = (row.telegramChatId?.trim() || row.telegramUserId).trim();
  if (!chatId) throw unlinkedError();

  try {
    await sendHorizonDocument({
      chatId,
      fileName: filename,
      contentType: mimeType,
      bytes: input.bytes,
    });
  } catch (err) {
    if (err instanceof HorizonTelegramChatUnreachableError) {
      throw new AppError(
        'Open a chat with the Horizon bot first, then try the export again.',
        { statusCode: 409, code: 'TELEGRAM_CHAT_UNREACHABLE', expose: true, cause: err },
      );
    }
    throw new AppError("Couldn't send the file to your Horizon bot chat. Please try again.", {
      statusCode: 502,
      code: 'HORIZON_EXPORT_SEND_FAILED',
      expose: true,
      cause: err,
    });
  }

  return { chatId, telegramUserId: row.telegramUserId, filename };
}
