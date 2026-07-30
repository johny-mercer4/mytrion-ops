import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { listDwhTransactions } from '../../integrations/dwhTransactions.js';
import {
  sendDocument,
  TelegramChatUnreachableError,
} from '../../integrations/telegramCarrierBot.js';
import { AppError } from '../../lib/errors.js';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import { TXN_FETCH_LIMIT } from '../../modules/carrier/driverCardScope.js';
import { requireDriverCardNumber, telegramCtx } from '../../modules/carrier/miniAppAuth.js';
import {
  resolveSupportBotCaller,
  resolveSupportBotCardByLast6,
  sendSupportBotPrivate,
  supportBotCallerSchema,
} from '../../modules/carrier/supportBotCaller.js';
import {
  fileServiceRequest,
  SERVICE_REQUEST_KEYS,
  serviceRequestAllows,
} from '../../modules/carrier/serviceRequest.js';
import { buildTxnReport } from '../../modules/carrier/txnReport.js';
import { takeToken } from '../../modules/security/rateBucket.js';
import { serverCrmWrapper } from '../../wrappers/serverCrmWrapper.js';
import { requireContext } from './helpers.js';

function takeReadToken(carrierId: string): void {
  if (!takeToken(`support-bot-read:${carrierId}`, 30)) {
    throw new AppError('Too many requests right now — try again in a minute.', {
      statusCode: 429,
      code: 'SUPPORT_BOT_RATE_LIMITED',
      expose: true,
    });
  }
}

/** Private document delivery and service-request routes. */
export async function supportBotDocumentRoutes(
  app: FastifyInstance,
): Promise<void> {
  const guard = { onRequest: [app.sessionOrApiKey] };

  app.post('/support-bot/invoice', guard, async (request) => {
    const body = supportBotCallerSchema
      .extend({ format: z.enum(['pdf', 'xlsx']).default('pdf') })
      .parse(request.body);
    const { registration, role } = await resolveSupportBotCaller(
      requireContext(request),
      body.carrierId,
      body.telegramUserId,
    );
    if (role !== 'owner') {
      throw new AppError('Invoices are available to the company owner only.', {
        statusCode: 403,
        code: 'OWNER_ONLY',
        expose: true,
      });
    }
    takeReadToken(body.carrierId);
    const list = await serverCrmWrapper.getInvoices(body.carrierId, {
      range: 'all_time',
    });
    const rows = (list.data ?? []) as Array<Record<string, unknown>>;
    if (rows.length === 0) {
      throw new AppError('No invoices on file for this account.', {
        statusCode: 404,
        code: 'NO_INVOICES',
        expose: true,
      });
    }
    const dated = [...rows].sort((a, b) =>
      String(b['invoice_date'] ?? b['created_at'] ?? '').localeCompare(
        String(a['invoice_date'] ?? a['created_at'] ?? ''),
      ),
    );
    const invoice = dated[0];
    const invoiceId = String(invoice?.['invoice_id'] ?? invoice?.['id'] ?? '');
    const signed = (await serverCrmWrapper.getInvoiceSignedUrl(
      invoiceId,
      body.format,
    )) as Record<string, unknown>;
    const url = String(signed['url'] ?? signed['signed_url'] ?? '');
    if (!invoiceId || !url) {
      throw new AppError("Couldn't prepare that invoice document.", {
        statusCode: 502,
        code: 'INVOICE_URL_FAILED',
        expose: true,
      });
    }
    const response = await fetch(url);
    if (!response.ok) {
      throw new AppError(
        "Couldn't fetch the invoice document. Please try again.",
        { statusCode: 502, code: 'INVOICE_FETCH_FAILED', expose: true },
      );
    }
    try {
      await sendDocument({
        chatId: registration.telegramChatId ?? body.telegramUserId,
        fileName: `Octane_Invoice_${invoiceId}.${body.format}`,
        contentType:
          body.format === 'pdf'
            ? 'application/pdf'
            : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        bytes: Buffer.from(await response.arrayBuffer()),
        caption: `Octane · Invoice #${invoiceId}`,
      });
    } catch (error) {
      if (error instanceof TelegramChatUnreachableError) {
        throw new AppError(
          'They must open a chat with the Octane bot first, then ask again.',
          {
            statusCode: 409,
            code: 'TELEGRAM_CHAT_UNREACHABLE',
            expose: true,
            cause: error,
          },
        );
      }
      throw error;
    }
    return {
      sent: true,
      invoiceId,
      note: "Document sent to the asker's PRIVATE bot chat — tell them to check it",
    };
  });

  app.post('/support-bot/invoices', guard, async (request) => {
    const body = supportBotCallerSchema
      .extend({
        range: z
          .enum(['last_7', 'last_30', 'last_90', 'last_365', 'all_time'])
          .default('last_90'),
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      })
      .parse(request.body);
    const { registration, role } = await resolveSupportBotCaller(
      requireContext(request),
      body.carrierId,
      body.telegramUserId,
    );
    if (role !== 'owner') {
      throw new AppError('Invoices are available to the company owner only.', {
        statusCode: 403,
        code: 'OWNER_ONLY',
        expose: true,
      });
    }
    takeReadToken(body.carrierId);
    const list = await serverCrmWrapper.getInvoices(body.carrierId, {
      range: body.range,
      ...(body.from ? { from: body.from } : {}),
      ...(body.to ? { to: body.to } : {}),
    });
    const rows = (list.data ?? []) as Array<Record<string, unknown>>;
    const summary = (
      (list as Record<string, unknown>)['summary'] ?? {}
    ) as Record<string, unknown>;
    const money = (value: unknown) =>
      `$${Number(value ?? 0).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;
    const label =
      body.from && body.to
        ? `${body.from} — ${body.to}`
        : body.range.replace('_', ' ');
    const lines = rows.slice(0, 8).map((row) => {
      const id = String(row['invoice_id'] ?? row['id'] ?? '');
      const date = String(
        row['invoice_date'] ?? row['created_at'] ?? '',
      ).slice(0, 10);
      const status = String(row['status'] ?? '').replace(/_/g, ' ');
      return `#${id} · ${date} · ${status} · ${money(row['total_amount'])}`;
    });
    if (rows.length > 0) {
      await sendSupportBotPrivate(
        registration,
        [
          `📄 Octane · Invoices (${label})`,
          `Billed: ${money(summary['sum_total_amount'])} · Open: ${money(summary['sum_open_balance'])}`,
          '',
          ...lines,
          rows.length > 8
            ? `… +${rows.length - 8} more (mini-app → Invoices)`
            : '',
        ]
          .filter(Boolean)
          .join('\n'),
      );
    }
    return {
      sent: rows.length > 0,
      count: rows.length,
      open_count: Number(summary['open_count'] ?? 0),
      paid_count: Number(summary['paid_count'] ?? 0),
      latest: rows[0]
        ? {
            invoiceId: String(rows[0]['invoice_id'] ?? rows[0]['id'] ?? ''),
            date: String(rows[0]['invoice_date'] ?? '').slice(0, 10),
            status: String(rows[0]['status'] ?? ''),
          }
        : null,
      note: "FIGURES went to the asker's PRIVATE chat. Inline you may say ONLY counts/statuses/dates — never amounts.",
    };
  });

  app.post('/support-bot/txn-report', guard, async (request) => {
    const body = supportBotCallerSchema
      .extend({
        range: z.string().max(20).default('week'),
        from: z.string().max(10).optional(),
        to: z.string().max(10).optional(),
        format: z.enum(['csv', 'xlsx', 'pdf']).default('xlsx'),
        cardLast6: z.string().trim().min(4).max(19).optional(),
      })
      .parse(request.body);
    const { registration, role } = await resolveSupportBotCaller(
      requireContext(request),
      body.carrierId,
      body.telegramUserId,
    );
    takeReadToken(body.carrierId);
    const cardNumber =
      role === 'driver'
        ? await requireDriverCardNumber(registration)
        : body.cardLast6
          ? await resolveSupportBotCardByLast6(
              body.carrierId,
              body.cardLast6,
            )
          : null;
    const result = await listDwhTransactions({
      carrierId: body.carrierId,
      ...(cardNumber ? { cardNumber } : {}),
      range: body.from && body.to ? 'custom' : body.range,
      ...(body.from ? { from: body.from } : {}),
      ...(body.to ? { to: body.to } : {}),
      limit: TXN_FETCH_LIMIT,
    });
    if (result.data.length === 0) {
      throw new AppError('There are no transactions in that period.', {
        statusCode: 404,
        code: 'TXN_EXPORT_EMPTY',
        expose: true,
      });
    }
    const rangeLabel = result.range.from
      ? `${result.range.from} → ${result.range.to}`
      : String(result.range.preset);
    const report = await buildTxnReport(result.data, body.format, {
      company: registration.companyName ?? 'Octane',
      range: rangeLabel,
      cardLast4: cardNumber ? cardNumber.slice(-6) : body.carrierId,
      scopedToCard: Boolean(cardNumber),
      priceMode: role === 'driver' ? 'retail' : 'discount',
      detailed: false,
    });
    try {
      await sendDocument({
        chatId:
          registration.telegramChatId ?? registration.telegramUserId,
        fileName: report.fileName,
        contentType: report.contentType,
        bytes: report.bytes,
        caption: `Octane · Transaction Report · ${rangeLabel}`,
      });
    } catch (error) {
      if (error instanceof TelegramChatUnreachableError) {
        throw new AppError(
          'Open a chat with the Octane bot first, then ask again.',
          {
            statusCode: 409,
            code: 'TELEGRAM_CHAT_UNREACHABLE',
            expose: true,
            cause: error,
          },
        );
      }
      throw error;
    }
    await auditFromContext(
      telegramCtx(registration.profile, registration.telegramUserId),
      {
        action: 'carrier.support_bot.txn_report',
        status: 'ok',
        resourceType: 'txn_report',
        resourceId: body.carrierId,
        detail: {
          carrierId: body.carrierId,
          role,
          range: body.range,
          format: body.format,
        },
      },
    );
    return {
      success: true,
      deliveredTo: 'private_bot_chat',
      rows: result.data.length,
    };
  });

  app.post('/support-bot/service-request', guard, async (request) => {
    const body = supportBotCallerSchema
      .extend({
        request: z.enum(SERVICE_REQUEST_KEYS),
        comment: z.string().max(2000).default(''),
      })
      .parse(request.body);
    const { registration, role } = await resolveSupportBotCaller(
      requireContext(request),
      body.carrierId,
      body.telegramUserId,
    );
    if (!serviceRequestAllows(body.request, role)) {
      throw new AppError('This request type is not available for your role.', {
        statusCode: 403,
        code: 'SUPPORT_BOT_REQUEST_ROLE',
        expose: true,
      });
    }
    if (!takeToken(`support-bot-ticket:${body.carrierId}`, 10)) {
      throw new AppError('Too many requests right now — try again in a minute.', {
        statusCode: 429,
        code: 'SUPPORT_BOT_RATE_LIMITED',
        expose: true,
      });
    }
    const cardNumber =
      role === 'driver'
        ? await requireDriverCardNumber(registration).catch(() => null)
        : null;
    const ticketId = await fileServiceRequest({
      key: body.request,
      profile: role,
      carrierId: body.carrierId,
      cardNumber,
      requesterName:
        registration.driverName ??
        registration.companyName ??
        'Client',
      telegramUserId: registration.telegramUserId,
      telegramUsername: registration.telegramUsername,
      companyName: registration.companyName,
      comment: body.comment || null,
    });
    await auditFromContext(
      telegramCtx(registration.profile, registration.telegramUserId),
      {
        action: 'carrier.support_bot.service_request',
        status: 'ok',
        resourceType: 'desk_ticket',
        resourceId: ticketId,
        detail: {
          carrierId: body.carrierId,
          role,
          request: body.request,
        },
      },
    );
    return { ticketId, request: body.request };
  });
}
