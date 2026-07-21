/**
 * /v1/support-bot — the hamroh group-bot's RBAC'd doorway into carrier services.
 *
 * Trust model: the BOT process is trusted (internal API key), the MODEL inside it is not.
 * So the ROLE never comes from the request — every call resolves the asking group member's
 * telegramUserId against registered_mini_app_companies (the same table the mini-app trusts)
 * and the answer is shaped by THAT registration:
 *
 *   driver → own-card scope only, no dollar figures (funds = boolean), retail-only reports;
 *   owner  → company-level figures and fleet-wide reads;
 *   anyone else (unregistered / revoked / registered under ANOTHER carrier) → 403/404,
 *   which is what makes "never talk about other companies" real: the bot instance is
 *   deployed with ONE carrierId (env), and a registration that doesn't match it is
 *   indistinguishable from not being registered at all.
 *
 * This mirrors the mini-app's invariants exactly — one rule set, two doorways.
 */
import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import { env, isProduction } from '../../config/env.js';
import { db } from '../../db/client.js';
import { registeredMiniAppCompanies, type RegisteredMiniAppCompany } from '../../db/schema/index.js';
import { listDwhTransactions } from '../../integrations/dwhTransactions.js';
import { sendDocument, TelegramChatUnreachableError } from '../../integrations/telegramCarrierBot.js';
import { TXN_FETCH_LIMIT, scopeRowsToCard } from '../../modules/carrier/driverCardScope.js';
import { requireDriverCardNumber, telegramCtx } from '../../modules/carrier/miniAppAuth.js';
import { buildTxnReport } from '../../modules/carrier/txnReport.js';
import { notifyMiniApp } from '../../modules/notifications/service.js';
import { takeToken } from '../../modules/security/rateBucket.js';
import { efsWrapper } from '../../wrappers/efsWrapper.js';
import { serverCrmWrapper } from '../../wrappers/serverCrmWrapper.js';

const callerSchema = z.object({
  /** The GROUP MEMBER who asked — the bot harness passes the Telegram sender id. */
  telegramUserId: z.string().min(1).max(40),
  /** The bot instance's deployed carrier (env-per-instance) — must match the registration. */
  carrierId: z.string().min(1).max(40),
});

type SupportBotRole = 'owner' | 'driver';

/**
 * The single RBAC gate: who is this Telegram user WITHIN this bot instance's carrier?
 * Fail-closed on every mismatch — unregistered, revoked, or another company's registration
 * all land on the same terse errors (no probing which company someone belongs to).
 */
async function resolveCaller(
  carrierId: string,
  telegramUserId: string,
): Promise<{ registration: RegisteredMiniAppCompany; role: SupportBotRole }> {
  const rows = await db
    .select()
    .from(registeredMiniAppCompanies)
    .where(
      and(
        eq(registeredMiniAppCompanies.telegramUserId, telegramUserId),
        eq(registeredMiniAppCompanies.status, 'active'),
      ),
    )
    .limit(1);
  const registration = rows[0];
  if (!registration) {
    throw new AppError('This user is not registered in the mini-app yet.', {
      statusCode: 404,
      code: 'SUPPORT_BOT_NOT_REGISTERED',
      expose: true,
    });
  }
  if (String(registration.carrierId ?? '') !== carrierId) {
    throw new AppError('This user does not belong to this group’s company.', {
      statusCode: 403,
      code: 'SUPPORT_BOT_CARRIER_MISMATCH',
      expose: true,
    });
  }
  return { registration, role: registration.profile === 'driver' ? 'driver' : 'owner' };
}

function takeReadToken(carrierId: string): void {
  if (!takeToken(`support-bot-read:${carrierId}`, 30)) {
    throw new AppError('Too many requests right now — try again in a minute.', {
      statusCode: 429,
      code: 'SUPPORT_BOT_RATE_LIMITED',
      expose: true,
    });
  }
}

export async function supportBotRoutes(app: FastifyInstance): Promise<void> {
  const guard = { onRequest: [app.sessionOrApiKey] };

  /**
   * The bot instance's access list — WHO from this carrier may use the bot, sourced from the
   * registration table. hamroh syncs this into access.json (allowed_users) on boot + on a
   * timer, so revoking a mini-app registration also revokes bot access within minutes.
   */
  app.get('/support-bot/access', guard, async (request) => {
    const q = z.object({ carrierId: z.string().min(1).max(40) }).parse(request.query);
    const rows = await db
      .select({
        telegramUserId: registeredMiniAppCompanies.telegramUserId,
        profile: registeredMiniAppCompanies.profile,
        driverName: registeredMiniAppCompanies.driverName,
      })
      .from(registeredMiniAppCompanies)
      .where(
        and(
          eq(registeredMiniAppCompanies.carrierId, q.carrierId),
          eq(registeredMiniAppCompanies.status, 'active'),
        ),
      );
    return {
      carrierId: q.carrierId,
      users: rows.map((r) => ({ telegramUserId: r.telegramUserId, profile: r.profile, name: r.driverName })),
    };
  });

  /** Who is asking — lets the bot address the person correctly and offer the right menu. */
  app.post('/support-bot/whoami', guard, async (request) => {
    const body = callerSchema.parse(request.body);
    const { registration, role } = await resolveCaller(body.carrierId, body.telegramUserId);
    return {
      role,
      name: registration.driverName ?? null,
      companyName: registration.companyName ?? null,
    };
  });

  /**
   * Card status. driver → their own card's row only; owner → account standing + per-card
   * statuses (capped, like the mini-app's status sheet).
   */
  app.post('/support-bot/card-status', guard, async (request) => {
    const body = callerSchema.parse(request.body);
    const { registration, role } = await resolveCaller(body.carrierId, body.telegramUserId);
    takeReadToken(body.carrierId);
    const cards = await serverCrmWrapper.getCards(body.carrierId);
    if (role === 'driver') {
      const cardNumber = await requireDriverCardNumber(registration);
      const own = scopeRowsToCard(cards.data ?? [], cardNumber);
      const row = own[0] ?? null;
      return {
        role,
        card: row
          ? { last6: cardNumber.slice(-6), status: row['status'] ?? null, lastUsed: row['last_used'] ?? null }
          : { last6: cardNumber.slice(-6), status: null, lastUsed: null },
      };
    }
    const rows = (cards.data ?? []).slice(0, 30).map((r) => ({
      last6: String(r['card_number'] ?? '').slice(-6),
      status: r['status'] ?? null,
    }));
    return { role, count: cards.count ?? rows.length, activeCount: cards['active_count'] ?? null, cards: rows };
  });

  /**
   * Funds. owner → real figures (live EFS pool, credit fields). driver → boolean only —
   * the company's money is the owner's business (the mini-app /card/funds rule verbatim).
   */
  app.post('/support-bot/funds', guard, async (request) => {
    const body = callerSchema.parse(request.body);
    const { registration, role } = await resolveCaller(body.carrierId, body.telegramUserId);
    takeReadToken(body.carrierId);
    const balance = await serverCrmWrapper.getCarrierBalance(body.carrierId).catch(() => null);
    const efsBalance = balance?.efs_balance;
    const hasFunds = typeof efsBalance === 'number' ? efsBalance > 0 : null;
    if (role === 'driver') {
      let cardStatus: string | null = null;
      try {
        const cardNumber = await requireDriverCardNumber(registration);
        const cards = await serverCrmWrapper.getCards(body.carrierId).catch(() => null);
        const raw = scopeRowsToCard(cards?.data ?? [], cardNumber)[0]?.['status'];
        cardStatus = typeof raw === 'string' && raw ? raw : null;
      } catch {
        /* card unresolved — funds boolean still answers the question */
      }
      return { role, hasFunds, cardStatus };
    }
    return {
      role,
      hasFunds,
      efsBalance: efsBalance ?? null,
      creditRemaining: balance?.['credit_remaining'] ?? null,
      accountType: balance?.account_type ?? null,
      efsError: balance?.efs_error ?? null,
    };
  });

  /**
   * Transaction report — built server-side and delivered as a document to the ASKER'S OWN
   * bot chat (their DM with the Octane bot), never into the group: a fleet report pasted
   * into a group would show every member the owner's numbers. driver → own card, retail
   * forced; owner → whole fleet with discounts.
   */
  app.post('/support-bot/txn-report', guard, async (request) => {
    const body = callerSchema
      .extend({
        range: z.string().max(20).default('week'),
        format: z.enum(['csv', 'xlsx', 'pdf']).default('xlsx'),
      })
      .parse(request.body);
    const { registration, role } = await resolveCaller(body.carrierId, body.telegramUserId);
    takeReadToken(body.carrierId);
    const cardNumber = role === 'driver' ? await requireDriverCardNumber(registration) : null;
    const result = await listDwhTransactions({
      carrierId: body.carrierId,
      ...(cardNumber ? { cardNumber } : {}),
      range: body.range,
      limit: TXN_FETCH_LIMIT,
    });
    if (result.data.length === 0) {
      throw new AppError('There are no transactions in that period.', {
        statusCode: 404,
        code: 'TXN_EXPORT_EMPTY',
        expose: true,
      });
    }
    const rangeLabel = result.range.from ? `${result.range.from} → ${result.range.to}` : String(result.range.preset);
    const report = await buildTxnReport(result.data, body.format, {
      company: registration.companyName ?? 'Octane',
      range: rangeLabel,
      cardLast4: cardNumber ? cardNumber.slice(-6) : String(body.carrierId),
      scopedToCard: Boolean(cardNumber),
      priceMode: role === 'driver' ? 'retail' : 'discount',
      detailed: false,
    });
    try {
      await sendDocument({
        chatId: registration.telegramChatId ?? registration.telegramUserId,
        fileName: report.fileName,
        contentType: report.contentType,
        bytes: report.bytes,
        caption: `Octane · Transaction Report · ${rangeLabel}`,
      });
    } catch (err) {
      if (err instanceof TelegramChatUnreachableError) {
        throw new AppError('Open a chat with the Octane bot first, then ask again.', {
          statusCode: 409,
          code: 'TELEGRAM_CHAT_UNREACHABLE',
          expose: true,
          cause: err,
        });
      }
      throw err;
    }
    await auditFromContext(telegramCtx(registration.profile, registration.telegramUserId), {
      action: 'carrier.support_bot.txn_report',
      status: 'ok',
      resourceType: 'txn_report',
      resourceId: body.carrierId,
      detail: { carrierId: body.carrierId, role, range: body.range, format: body.format },
    });
    return { success: true, deliveredTo: 'private_bot_chat', rows: result.data.length };
  });

  /** Override — DRIVER-ONLY, own card, same flag/rate/audit/receipt as the mini-app. */
  app.post('/support-bot/override', guard, async (request) => {
    if (!env.FF_MINIAPP_CARD_WRITES_ENABLED) {
      throw new AppError('Card actions are not enabled yet.', {
        statusCode: 503,
        code: 'MINIAPP_WRITES_DISABLED',
        expose: true,
      });
    }
    const body = callerSchema.parse(request.body);
    const { registration, role } = await resolveCaller(body.carrierId, body.telegramUserId);
    if (role !== 'driver') {
      throw new AppError('Owners pick a card in the mini-app — open Card management there.', {
        statusCode: 403,
        code: 'SUPPORT_BOT_DRIVER_ONLY',
        expose: true,
      });
    }
    if (!takeToken(`support-bot-write:${body.carrierId}`, 5)) {
      throw new AppError('Too many card actions right now — try again in a minute.', {
        statusCode: 429,
        code: 'SUPPORT_BOT_RATE_LIMITED',
        expose: true,
      });
    }
    const cardNumber = await requireDriverCardNumber(registration);
    const ctx = telegramCtx('driver', registration.telegramUserId);
    const result =
      !isProduction && env.FF_DEV_MOCK_TELEGRAM_ENABLED
        ? { success: true, cardNumber, previousStatus: 'Hold', override: true, message: 'DEV MOCK — EFS not called' }
        : await efsWrapper.overrideCard(body.carrierId, cardNumber);
    await auditFromContext(ctx, {
      action: 'carrier.support_bot.card_override',
      status: 'ok',
      resourceType: 'efs_card',
      resourceId: registration.cardId ?? cardNumber.slice(-6),
      detail: { carrierId: body.carrierId, via: 'support-bot' },
    });
    void notifyMiniApp({
      type: 'override',
      tenantId: registration.tenantId,
      carrierId: body.carrierId,
      telegramUserId: registration.telegramUserId,
      dedupeKey: `override:${body.carrierId}:${registration.cardId ?? cardNumber.slice(-6)}:${Date.now()}`,
      payload: { last6: cardNumber.slice(-6), cardId: registration.cardId ?? '' },
    });
    return { success: true, last6: cardNumber.slice(-6), minutes: 30, raw: result };
  });
}
