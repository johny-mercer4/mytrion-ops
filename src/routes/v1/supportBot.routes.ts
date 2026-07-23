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
import { and, eq, isNotNull, ne } from 'drizzle-orm';
import { z } from 'zod';
import { AppError, RBACError } from '../../lib/errors.js';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import { env, isProduction } from '../../config/env.js';
import { db } from '../../db/client.js';
import { registeredMiniAppCompanies, supportBotChats, supportBotMessages, type RegisteredMiniAppCompany } from '../../db/schema/index.js';
import { DEFAULT_TENANT_ID } from '../../config/constants.js';
import { listDwhTransactions } from '../../integrations/dwhTransactions.js';
import { sendDocument, sendPlainReply, TelegramChatUnreachableError } from '../../integrations/telegramCarrierBot.js';
import { TXN_FETCH_LIMIT, scopeRowsToCard } from '../../modules/carrier/driverCardScope.js';
import { listLiveCardRows as listCardsLive } from '../../modules/carrier/liveCards.js';
import { requireDriverCardNumber, telegramCtx } from '../../modules/carrier/miniAppAuth.js';
import { fileServiceRequest, SERVICE_REQUEST_KEYS, serviceRequestAllows } from '../../modules/carrier/serviceRequest.js';
import { executeZohoFunctionWithFallback } from '../../integrations/zohoFunctions.js';
import { buildTxnReport } from '../../modules/carrier/txnReport.js';
import { notifyMiniApp } from '../../modules/notifications/service.js';
import { takeToken } from '../../modules/security/rateBucket.js';
import { efsWrapper } from '../../wrappers/efsWrapper.js';
import { serverCrmWrapper } from '../../wrappers/serverCrmWrapper.js';
import { requireContext } from './helpers.js';

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

/** Resolve an OWNER's spoken "last 6 digits" to exactly one card of THEIR carrier. Ambiguity
 *  (or no match) is an error — the bot asks for more digits rather than guessing a card. */
async function resolveCardByLast6(carrierId: string, last6: string): Promise<string> {
  const digits = last6.replace(/\D/g, '');
  if (digits.length < 4) {
    throw new AppError('Give at least the last 4-6 digits of the card.', { statusCode: 400, code: 'SUPPORT_BOT_CARD_DIGITS', expose: true });
  }
  const cards = await listCardsLive(carrierId);
  const matches = cards
    .map((r) => String(r['card_number'] ?? ''))
    .filter((n) => n && n.endsWith(digits));
  if (matches.length === 1) return matches[0]!;
  throw new AppError(
    matches.length === 0 ? 'No card on this account ends with those digits.' : 'More than one card ends with those digits — give the last 6.',
    { statusCode: matches.length === 0 ? 404 : 409, code: matches.length === 0 ? 'SUPPORT_BOT_CARD_NOT_FOUND' : 'SUPPORT_BOT_CARD_AMBIGUOUS', expose: true },
  );
}

function requireWrites(): void {
  if (!env.FF_MINIAPP_CARD_WRITES_ENABLED) {
    throw new AppError('Card actions are not enabled yet.', { statusCode: 503, code: 'MINIAPP_WRITES_DISABLED', expose: true });
  }
}

function takeWrite(carrierId: string): void {
  if (!takeToken(`support-bot-write:${carrierId}`, 5)) {
    throw new AppError('Too many card actions right now — try again in a minute.', { statusCode: 429, code: 'SUPPORT_BOT_RATE_LIMITED', expose: true });
  }
}

/** Deliver sensitive content to the asker's PRIVATE Octane bot chat — never the group. */
async function dmOrThrow(reg: RegisteredMiniAppCompany, text: string): Promise<void> {
  await sendPlainReply(reg.telegramChatId ?? reg.telegramUserId, text);
}

export async function supportBotRoutes(app: FastifyInstance): Promise<void> {
  const messagesBatchSchema = z.object({
    carrierId: z.string().min(1),
    messages: z
      .array(
        z.object({
          ts: z.string().max(40),
          chatId: z.union([z.string(), z.number()]),
          msgId: z.union([z.string(), z.number()]).optional(),
          userId: z.union([z.string(), z.number()]),
          name: z.string().max(200),
          dir: z.enum(['in', 'out']),
          text: z.string().max(8000),
          photo: z.boolean().optional(),
          engaged: z.boolean().optional(),
        }),
      )
      .min(1)
      .max(200),
  });

  const guard = { onRequest: [app.sessionOrApiKey] };

  /**
   * Multi-session chat map (MULTISESSION_ARCH M-0): which group chat belongs to which
   * carrier. The gateway caches this; adding a group here is what "onboards" a client
   * company onto the shared bot. Admin-RBAC'd writes, internal-key reads.
   */
  /**
   * Message-history ingest (hamroh-v1 parity, central Postgres). The gateway batches its
   * message log here; local JSONL remains its never-fails fallback, so this endpoint being
   * down only delays central copies. Internal-key/session guarded like every support-bot route.
   */
  app.post('/support-bot/messages', guard, async (request, reply) => {
    const body = messagesBatchSchema.parse(request.body);
    await db.insert(supportBotMessages).values(
      body.messages.map((m) => ({
        tenantId: DEFAULT_TENANT_ID,
        carrierId: body.carrierId,
        chatId: String(m.chatId),
        ...(m.msgId != null ? { msgId: String(m.msgId) } : {}),
        telegramUserId: String(m.userId),
        name: m.name,
        direction: m.dir,
        text: m.text,
        photo: m.photo ?? false,
        engaged: m.engaged ?? false,
        sentAt: new Date(m.ts),
      })),
    );
    return reply.code(201).send({ inserted: body.messages.length });
  });

  /**
   * Prod monitor passthrough (2026-07-23): the gateway's web monitor listens on localhost:8787
   * INSIDE the same container, and Render exposes only $PORT — so the dashboard was unreachable
   * in prod. These two routes proxy it at /v1/support-bot/monitor/?token=… . Auth is the
   * monitor's own MONITOR_TOKEN (browser-opened dashboard — no Bearer headers), and the proxy
   * FAILS CLOSED: with MONITOR_TOKEN unset in the environment it answers 404, so the dashboard
   * can never be exposed unauthenticated by accident.
   */
  const monitorUpstream = `http://localhost:${process.env['MONITOR_PORT'] ?? '8787'}`;
  async function proxyMonitor(
    path: string,
    request: { query: unknown },
    reply: { code: (n: number) => { send: (b: unknown) => unknown }; header: (k: string, v: string) => void },
  ): Promise<unknown> {
    if (!process.env['MONITOR_TOKEN']) return reply.code(404).send({ error: 'monitor disabled' });
    const token = String((request.query as Record<string, unknown>)?.['token'] ?? '');
    const res = await fetch(`${monitorUpstream}${path}?token=${encodeURIComponent(token)}`, {
      signal: AbortSignal.timeout(10_000),
    });
    reply.header('content-type', res.headers.get('content-type') ?? 'text/plain');
    return reply.code(res.status).send(Buffer.from(await res.arrayBuffer()));
  }
  // Without the trailing slash the dashboard's relative api fetch would resolve one level up.
  app.get('/support-bot/monitor', async (request, reply) => {
    const q = request.url.includes('?') ? request.url.slice(request.url.indexOf('?')) : '';
    return reply.redirect(`/v1/support-bot/monitor/${q}`);
  });
  app.get('/support-bot/monitor/', async (request, reply) => proxyMonitor('/', request, reply));
  app.get('/support-bot/monitor/api/turns', async (request, reply) => proxyMonitor('/api/turns', request, reply));

  app.get('/support-bot/chat-map', guard, async () => {
    const rows = await db.select().from(supportBotChats).where(eq(supportBotChats.enabled, true));
    return { chats: rows.map((r) => ({ chatId: r.chatId, carrierId: r.carrierId })) };
  });

  app.post('/support-bot/chat-map', guard, async (request, reply) => {
    const ctx = requireContext(request);
    if (ctx.role !== 'admin' && !ctx.bypassRbac) throw new RBACError('Mapping bot chats requires admin access');
    const body = z.object({ chatId: z.string().min(1).max(40), carrierId: z.string().min(1).max(40) }).parse(request.body);
    const [row] = await db
      .insert(supportBotChats)
      .values({ tenantId: ctx.tenantId, chatId: body.chatId, carrierId: body.carrierId, createdBy: ctx.userId })
      .onConflictDoUpdate({ target: supportBotChats.chatId, set: { carrierId: body.carrierId, enabled: true, updatedAt: new Date() } })
      .returning();
    await auditFromContext(ctx, {
      action: 'support_bot.chat_map.set',
      status: 'ok',
      resourceType: 'support_bot_chat',
      resourceId: body.chatId,
      detail: { carrierId: body.carrierId },
    });
    return reply.status(201).send(row);
  });

  /**
   * AUTO-BIND (owner decision 2026-07-22): when the bot lands in a NEW group, the first message
   * from an ACTIVE owner/manager registration binds that chat to the sender's carrier — no env
   * var, no admin step. Trust anchor: the sender's Telegram id is sender-verified by Telegram
   * and forwarded by the TRUSTED bot process (internal key), then matched against
   * registered_mini_app_companies. A stranger's group can never bind (404), drivers can't bind,
   * and an already-ENABLED mapping is never re-pointed (bound:false echo — re-pointing stays an
   * admin action via the POST above).
   */
  app.post('/support-bot/chat-map/auto-bind', guard, async (request, reply) => {
    const body = z
      .object({ chatId: z.string().min(1).max(40), telegramUserId: z.string().min(1).max(40) })
      .parse(request.body);
    const existing = await db
      .select()
      .from(supportBotChats)
      .where(eq(supportBotChats.chatId, body.chatId))
      .limit(1);
    if (existing[0]?.enabled) {
      return { carrierId: existing[0].carrierId, bound: false, companyName: null };
    }
    const regs = await db
      .select()
      .from(registeredMiniAppCompanies)
      .where(
        and(
          eq(registeredMiniAppCompanies.telegramUserId, body.telegramUserId),
          eq(registeredMiniAppCompanies.status, 'active'),
          ne(registeredMiniAppCompanies.profile, 'driver'),
          isNotNull(registeredMiniAppCompanies.carrierId),
        ),
      )
      .limit(1);
    const reg = regs[0];
    if (!reg?.carrierId) {
      throw new AppError('No active owner registration for this sender.', {
        statusCode: 404,
        code: 'SUPPORT_BOT_AUTO_BIND_NO_OWNER',
        expose: true,
      });
    }
    const [row] = await db
      .insert(supportBotChats)
      .values({
        tenantId: reg.tenantId,
        chatId: body.chatId,
        carrierId: reg.carrierId,
        createdBy: `auto:tg:${body.telegramUserId}`,
      })
      .onConflictDoUpdate({
        target: supportBotChats.chatId,
        set: { carrierId: reg.carrierId, enabled: true, updatedAt: new Date() },
      })
      .returning();
    const ctx = requireContext(request);
    await auditFromContext(ctx, {
      action: 'support_bot.chat_map.auto_bind',
      status: 'ok',
      resourceType: 'support_bot_chat',
      resourceId: body.chatId,
      detail: { carrierId: reg.carrierId, boundBy: body.telegramUserId },
    });
    return reply.status(201).send({ carrierId: row?.carrierId ?? reg.carrierId, bound: true, companyName: reg.companyName ?? null });
  });

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
    const cardRows = await listCardsLive(body.carrierId);
    if (role === 'driver') {
      const cardNumber = await requireDriverCardNumber(registration);
      const own = scopeRowsToCard(cardRows, cardNumber);
      const row = own[0] ?? null;
      // Gallon limits are the driver's own operational fact ("how many gallons left?") — a live
      // EFS diagnostics read, gallons only, no dollars. Best-effort: status still answers alone.
      const efsInfo = await efsWrapper.getCardEfsInfo(body.carrierId, cardNumber).catch(() => null) as Record<string, unknown> | null;
      return {
        role,
        card: row
          ? { last6: cardNumber.slice(-6), status: row['status'] ?? null, lastUsed: row['last_used'] ?? null }
          : { last6: cardNumber.slice(-6), status: null, lastUsed: null },
        limits: efsInfo?.['limits'] ?? null,
      };
    }
    const rows = cardRows.slice(0, 30).map((r) => ({
      last6: String(r['card_number'] ?? '').slice(-6),
      status: r['status'] ?? null,
    }));
    const activeCount = cardRows.filter((r) => String(r['status'] ?? '').toLowerCase() === 'active').length;
    return { role, count: cardRows.length, activeCount, cards: rows };
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
        const cards = await listCardsLive(body.carrierId).catch(() => null);
        const raw = scopeRowsToCard(cards ?? [], cardNumber)[0]?.['status'];
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
   * Recent transactions INLINE — the "oxirgi tranzaksiyalarim qanaqa?" quick answer. One row
   * per physical transaction (line items collapsed, receipt-poller style). DELIBERATELY carries
   * NO dollar figures for either role: money never lands in the group; dollar detail rides the
   * txn-report file to the DM. Driver: own card only. Owner: whole fleet or one card by last6.
   */
  app.post('/support-bot/transactions', guard, async (request) => {
    const body = callerSchema
      .extend({
        range: z.string().max(20).default('week'),
        card_last6: z.string().min(4).max(19).optional(),
        limit: z.coerce.number().int().positive().max(20).default(10),
      })
      .parse(request.body);
    const { registration, role } = await resolveCaller(body.carrierId, body.telegramUserId);
    takeReadToken(body.carrierId);
    const cardNumber =
      role === 'driver'
        ? await requireDriverCardNumber(registration)
        : body.card_last6
          ? await resolveCardByLast6(body.carrierId, body.card_last6)
          : null;
    const result = await listDwhTransactions({
      carrierId: body.carrierId,
      ...(cardNumber ? { cardNumber } : {}),
      range: body.range,
      limit: 200,
    });
    const byTxn = new Map<string, { last6: string; date: string; gallons: number; location: string; place: string }>();
    for (const r of result.data) {
      const txnId = String(r['transaction_id'] ?? '');
      if (!txnId) continue;
      const g = Number(r['line_item_fuel_quantity'] ?? 0) || 0;
      const cur = byTxn.get(txnId);
      if (cur) {
        cur.gallons += g;
      } else {
        byTxn.set(txnId, {
          last6: String(r['card_number'] ?? '').slice(-6),
          date: String(r['transaction_date'] ?? ''),
          gallons: g,
          location: String(r['location_name'] ?? ''),
          place: [r['location_city'], r['location_state']].map((v) => (typeof v === 'string' ? v : '')).filter(Boolean).join(' '),
        });
      }
    }
    const transactions = [...byTxn.values()]
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .slice(0, body.limit)
      .map((t2) => ({ ...t2, gallons: Number(t2.gallons.toFixed(2)) }));
    return {
      role,
      scope: cardNumber ? `card •••• ${cardNumber.slice(-6)}` : 'fleet',
      count: byTxn.size,
      transactions,
      note: 'No dollar figures by design — offer octane_txn_report (DM file) for amounts.',
    };
  });

  /**
   * Latest invoice PDF → the OWNER's private bot chat ("oxirgi invoice tashlab ber" — a
   * recurring group ask). Reuses the mini-app's exact delivery mechanics (signed URL → bytes →
   * sendDocument DM); owner-only, company finances. Never lands in the group.
   */
  app.post('/support-bot/invoice', guard, async (request) => {
    const body = callerSchema
      .extend({
        /** 2026-07-22: Excel joins PDF — same wrapper mapping ('xlsx' -> upstream 'excel') as the mini-app. */
        format: z.enum(['pdf', 'xlsx']).default('pdf'),
      })
      .parse(request.body);
    const { registration, role } = await resolveCaller(body.carrierId, body.telegramUserId);
    if (role !== 'owner') {
      throw new AppError('Invoices are available to the company owner only.', {
        statusCode: 403,
        code: 'OWNER_ONLY',
        expose: true,
      });
    }
    takeReadToken(body.carrierId);
    const list = await serverCrmWrapper.getInvoices(body.carrierId, { range: 'all_time' });
    const rows = (list.data ?? []) as Array<Record<string, unknown>>;
    if (rows.length === 0) {
      throw new AppError('No invoices on file for this account.', { statusCode: 404, code: 'NO_INVOICES', expose: true });
    }
    // Latest by invoice date when present; the list's own order otherwise.
    const dated = [...rows].sort((a, b) => String(b['invoice_date'] ?? b['created_at'] ?? '').localeCompare(String(a['invoice_date'] ?? a['created_at'] ?? '')));
    const inv = dated[0] as Record<string, unknown>;
    const invoiceId = String(inv['invoice_id'] ?? inv['id'] ?? '');
    const signed = (await serverCrmWrapper.getInvoiceSignedUrl(invoiceId, body.format)) as Record<string, unknown>;
    const url = String(signed['url'] ?? signed['signed_url'] ?? '');
    if (!invoiceId || !url) {
      throw new AppError("Couldn't prepare that invoice document.", { statusCode: 502, code: 'INVOICE_URL_FAILED', expose: true });
    }
    const res = await fetch(url);
    if (!res.ok) {
      throw new AppError("Couldn't fetch the invoice document. Please try again.", { statusCode: 502, code: 'INVOICE_FETCH_FAILED', expose: true });
    }
    const bytes = Buffer.from(await res.arrayBuffer());
    try {
      await sendDocument({
        chatId: registration.telegramChatId ?? body.telegramUserId,
        fileName: `Octane_Invoice_${invoiceId}.${body.format}`,
        contentType: body.format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        bytes,
        caption: `Octane · Invoice #${invoiceId}`,
      });
    } catch (err) {
      if (err instanceof TelegramChatUnreachableError) {
        throw new AppError('They must open a chat with the Octane bot first, then ask again.', {
          statusCode: 409,
          code: 'TELEGRAM_CHAT_UNREACHABLE',
          expose: true,
          cause: err,
        });
      }
      throw err;
    }
    return { sent: true, invoiceId, note: 'Document sent to the asker\'s PRIVATE bot chat — tell them to check it' };
  });

  /**
   * Invoice QUESTIONS ("qancha qarzim bor", "may oyi invoicelari") — owner-only. The DOLLAR
   * FIGURES are composed server-side and sent to the asker's PRIVATE bot chat (company money
   * never enters the group — same stance as /balance and /txn-report); the tool result carries
   * only counts/statuses/dates, which ARE safe to say inline. Range mirrors the mini-app
   * invoices sheet (presets + custom from/to; the wrapper flips to range=custom itself).
   */
  app.post('/support-bot/invoices', guard, async (request) => {
    const body = callerSchema
      .extend({
        range: z.enum(['last_7', 'last_30', 'last_90', 'last_365', 'all_time']).default('last_90'),
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      })
      .parse(request.body);
    const { registration, role } = await resolveCaller(body.carrierId, body.telegramUserId);
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
    const sum = ((list as unknown as Record<string, unknown>)['summary'] ?? {}) as Record<string, unknown>;
    const money = (v: unknown) => `$${Number(v ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const label = body.from && body.to ? `${body.from} — ${body.to}` : body.range.replace('_', ' ');
    const lines = rows.slice(0, 8).map((r) => {
      const id = String(r['invoice_id'] ?? r['id'] ?? '');
      const date = String(r['invoice_date'] ?? r['created_at'] ?? '').slice(0, 10);
      const status = String(r['status'] ?? '').replace(/_/g, ' ');
      return `#${id} · ${date} · ${status} · ${money(r['total_amount'])}`;
    });
    if (rows.length > 0) {
      await sendPlainReply(
        registration.telegramChatId ?? body.telegramUserId,
        [
          `📄 Octane · Invoices (${label})`,
          `Billed: ${money(sum['sum_total_amount'])} · Open: ${money(sum['sum_open_balance'])}`,
          '',
          ...lines,
          rows.length > 8 ? `… +${rows.length - 8} more (mini-app → Invoices)` : '',
        ].filter(Boolean).join('\n'),
      );
    }
    return {
      sent: rows.length > 0,
      count: rows.length,
      open_count: Number(sum['open_count'] ?? 0),
      paid_count: Number(sum['paid_count'] ?? 0),
      latest: rows[0]
        ? { invoiceId: String(rows[0]['invoice_id'] ?? rows[0]['id'] ?? ''), date: String(rows[0]['invoice_date'] ?? '').slice(0, 10), status: String(rows[0]['status'] ?? '') }
        : null,
      note: 'FIGURES went to the asker\'s PRIVATE chat. Inline you may say ONLY counts/statuses/dates — never amounts.',
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
        // Live gap 2026-07-22: a driver asked for 07.20–07.22 and the bot could only shrug at
        // presets. listDwhTransactions has always supported custom windows — expose them.
        from: z.string().max(10).optional(),
        to: z.string().max(10).optional(),
        format: z.enum(['csv', 'xlsx', 'pdf']).default('xlsx'),
      })
      .parse(request.body);
    const { registration, role } = await resolveCaller(body.carrierId, body.telegramUserId);
    takeReadToken(body.carrierId);
    const cardNumber = role === 'driver' ? await requireDriverCardNumber(registration) : null;
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

  /**
   * Service requests (Desk tickets) — the WHOLE mini-app ticket family through one door:
   * billing-form, card-replace, card-fraud, account-reactivate, dispute-txn,
   * money-code / card-activate / card-limit / override-card as REQUEST fallbacks. Role
   * gating is the same table the mini-app uses (serviceRequestAllows), the driver's card is
   * resolved server-side (never caller-supplied), and the comment is ticket BODY — data,
   * not instructions.
   */
  app.post('/support-bot/service-request', guard, async (request) => {
    const body = callerSchema
      .extend({ request: z.enum(SERVICE_REQUEST_KEYS), comment: z.string().max(2000).default('') })
      .parse(request.body);
    const { registration, role } = await resolveCaller(body.carrierId, body.telegramUserId);
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
    const cardNumber = role === 'driver' ? await requireDriverCardNumber(registration).catch(() => null) : null;
    const ticketId = await fileServiceRequest({
      key: body.request,
      profile: role,
      carrierId: body.carrierId,
      cardNumber,
      requesterName: registration.driverName ?? registration.companyName ?? 'Client',
      telegramUserId: registration.telegramUserId,
      telegramUsername: registration.telegramUsername,
      companyName: registration.companyName,
      comment: body.comment || null,
    });
    await auditFromContext(telegramCtx(registration.profile, registration.telegramUserId), {
      action: 'carrier.support_bot.service_request',
      status: 'ok',
      resourceType: 'desk_ticket',
      resourceId: ticketId,
      detail: { carrierId: body.carrierId, role, request: body.request },
    });
    return { ticketId, request: body.request };
  });

  /** Card shipment tracking — owner read (68 chat asks). Same shape the mini-app uses. */
  app.post('/support-bot/tracking', guard, async (request) => {
    const body = callerSchema.parse(request.body);
    const { role } = await resolveCaller(body.carrierId, body.telegramUserId);
    if (role !== 'owner') {
      throw new AppError('Shipment tracking is available to the account owner.', {
        statusCode: 403,
        code: 'SUPPORT_BOT_OWNER_ONLY',
        expose: true,
      });
    }
    takeReadToken(body.carrierId);
    try {
      return await executeZohoFunctionWithFallback(['mytriontruckingnumberrequest'], { carrierId: body.carrierId }, { unwrap: 'status' });
    } catch (err) {
      throw new AppError('Tracking lookup failed', { statusCode: 502, code: 'TRACKING_ERROR', expose: true, cause: err });
    }
  });

  /**
   * Money code — FULL service through the bot (prod parity), with the standing rule intact:
   * the CODE VALUE never appears in the group. It is drawn here and delivered to the OWNER'S
   * private Octane bot chat; the group only hears "sent to your private chat".
   */
  app.post('/support-bot/money-code/draw', guard, async (request) => {
    if (!env.FF_MINIAPP_MONEY_CODE_ENABLED) {
      throw new AppError('Money code is not enabled yet.', { statusCode: 503, code: 'MINIAPP_MONEY_CODE_DISABLED', expose: true });
    }
    const body = callerSchema
      .extend({ amount: z.coerce.number().positive(), unitNumber: z.string().trim().min(1).max(60), reason: z.string().trim().min(1).max(120) })
      .parse(request.body);
    const { registration, role } = await resolveCaller(body.carrierId, body.telegramUserId);
    if (role !== 'owner') {
      throw new AppError('Money codes are issued by the account owner.', { statusCode: 403, code: 'SUPPORT_BOT_OWNER_ONLY', expose: true });
    }
    takeWrite(body.carrierId);
    const result = (await serverCrmWrapper.drawMoneyCode(body.carrierId, {
      amount: body.amount,
      unitNumber: body.unitNumber,
      reason: body.reason,
      requestedBy: `support-bot: ${registration.companyName ?? 'owner'} (telegram:${registration.telegramUserId})`,
    })) as Record<string, unknown>;
    const code = [result['code'], result['money_code'], result['moneyCode'], result['express_code']]
      .map((v) => (v == null ? '' : String(v)))
      .find((v) => v.length >= 4);
    await dmOrThrow(
      registration,
      code
        ? `💵 Money code (unit ${body.unitNumber}, $${body.amount}):\n${code}\n${body.reason}`
        : `💵 Money code issued (unit ${body.unitNumber}, $${body.amount}) — open the mini-app to view it.`,
    );
    await auditFromContext(telegramCtx('owner', registration.telegramUserId), {
      action: 'carrier.support_bot.money_code_draw',
      status: 'ok',
      resourceType: 'money_code',
      resourceId: String(body.carrierId),
      detail: { carrierId: body.carrierId, amount: body.amount, unitNumber: body.unitNumber, via: 'support-bot' },
    });
    return { success: true, deliveredTo: 'private_bot_chat' };
  });

  /** Activate / deactivate a card by its last digits — owner, writes flag, ambiguity = ask. */
  app.post('/support-bot/card-action', guard, async (request) => {
    requireWrites();
    const body = callerSchema
      .extend({ cardLast6: z.string().trim().min(4).max(19), action: z.enum(['activate', 'deactivate']) })
      .parse(request.body);
    const { registration, role } = await resolveCaller(body.carrierId, body.telegramUserId);
    if (role !== 'owner') {
      throw new AppError('Card activation is an owner action.', { statusCode: 403, code: 'SUPPORT_BOT_OWNER_ONLY', expose: true });
    }
    takeWrite(body.carrierId);
    const cardNumber = await resolveCardByLast6(body.carrierId, body.cardLast6);
    const result = await efsWrapper.setCardStatus(body.carrierId, cardNumber, body.action);
    await auditFromContext(telegramCtx('owner', registration.telegramUserId), {
      action: 'carrier.support_bot.card_status_change',
      status: 'ok',
      resourceType: 'efs_card',
      resourceId: cardNumber.slice(-6),
      detail: { carrierId: body.carrierId, action: body.action, via: 'support-bot' },
    });
    return { success: true, last6: cardNumber.slice(-6), action: body.action, raw: result };
  });

  /** Gallon limit change — owner, capped like the mini-app (MINIAPP_LIMIT_CHANGE_MAX). */
  app.post('/support-bot/card-limits', guard, async (request) => {
    requireWrites();
    const body = callerSchema
      .extend({
        cardLast6: z.string().trim().min(4).max(19),
        limitId: z.enum(['ULSD', 'DEFD']),
        action: z.enum(['increase', 'decrease']),
        value: z.coerce.number().positive().max(env.MINIAPP_LIMIT_CHANGE_MAX),
      })
      .parse(request.body);
    const { registration, role } = await resolveCaller(body.carrierId, body.telegramUserId);
    if (role !== 'owner') {
      throw new AppError('Limit changes are an owner action.', { statusCode: 403, code: 'SUPPORT_BOT_OWNER_ONLY', expose: true });
    }
    takeWrite(body.carrierId);
    const cardNumber = await resolveCardByLast6(body.carrierId, body.cardLast6);
    const result = await efsWrapper.setCardLimits(body.carrierId, cardNumber, { limitId: body.limitId, value: body.value, action: body.action });
    await auditFromContext(telegramCtx('owner', registration.telegramUserId), {
      action: 'carrier.support_bot.card_limits_change',
      status: 'ok',
      resourceType: 'efs_card',
      resourceId: cardNumber.slice(-6),
      detail: { carrierId: body.carrierId, limitId: body.limitId, action: body.action, value: body.value, via: 'support-bot' },
    });
    return { success: true, last6: cardNumber.slice(-6), raw: result };
  });

  /** Unit / Driver ID / (owner-only) driver name — same rules as the mini-app's card/info. */
  app.post('/support-bot/card-info', guard, async (request) => {
    requireWrites();
    const body = callerSchema
      .extend({
        cardLast6: z.string().trim().min(4).max(19).optional(),
        unitNumber: z.string().trim().min(1).max(60).optional(),
        driverId: z.string().trim().min(1).max(60).optional(),
        driverName: z.string().trim().min(1).max(120).optional(),
      })
      .parse(request.body);
    if (!body.unitNumber && !body.driverId && !body.driverName) {
      throw new AppError('Provide a unit number, driver ID, or driver name to change.', { statusCode: 400, code: 'CARD_INFO_EMPTY', expose: true });
    }
    const { registration, role } = await resolveCaller(body.carrierId, body.telegramUserId);
    if (role === 'driver' && body.driverName) {
      throw new AppError('The driver name on the card is managed by your company owner.', { statusCode: 403, code: 'DRIVER_NAME_OWNER_ONLY', expose: true });
    }
    takeWrite(body.carrierId);
    const cardNumber =
      role === 'driver'
        ? await requireDriverCardNumber(registration)
        : await resolveCardByLast6(body.carrierId, body.cardLast6 ?? '');
    const result = await efsWrapper.updateCardInfo(body.carrierId, cardNumber, {
      ...(body.unitNumber ? { unitNumber: body.unitNumber } : {}),
      ...(body.driverId ? { driverId: body.driverId } : {}),
      ...(body.driverName ? { driverName: body.driverName } : {}),
    });
    await auditFromContext(telegramCtx(registration.profile, registration.telegramUserId), {
      action: 'carrier.support_bot.card_info_change',
      status: 'ok',
      resourceType: 'efs_card',
      resourceId: cardNumber.slice(-6),
      detail: { carrierId: body.carrierId, role, fields: Object.keys(body).filter((k) => ['unitNumber', 'driverId', 'driverName'].includes(k)), via: 'support-bot' },
    });
    return { success: true, last6: cardNumber.slice(-6), raw: result };
  });

  /** Balance FIGURES — owner, delivered to their PRIVATE bot chat (never the group). */
  app.post('/support-bot/balance', guard, async (request) => {
    const body = callerSchema.parse(request.body);
    const { registration, role } = await resolveCaller(body.carrierId, body.telegramUserId);
    if (role !== 'owner') {
      throw new AppError('Balance figures are for the account owner.', { statusCode: 403, code: 'SUPPORT_BOT_OWNER_ONLY', expose: true });
    }
    takeReadToken(body.carrierId);
    const b = await serverCrmWrapper.getCarrierBalance(body.carrierId);
    const fmt = (v: unknown): string => (typeof v === 'number' ? `$${v.toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '—');
    await dmOrThrow(
      registration,
      [`💰 ${registration.companyName ?? 'Octane'} balance`, `EFS balance: ${fmt(b.efs_balance)}`, ...(b['credit_remaining'] != null ? [`Credit remaining: ${fmt(b['credit_remaining'])}`] : []), ...(b.efs_error ? ['⚠ EFS live read failed — figures may be stale'] : [])].join('\n'),
    );
    return { success: true, deliveredTo: 'private_bot_chat' };
  });

  /** Manual entry code (= the full card number) — DM ONLY, own card for drivers. */
  app.post('/support-bot/manual-code', guard, async (request) => {
    const body = callerSchema.extend({ cardLast6: z.string().trim().min(4).max(19).optional() }).parse(request.body);
    const { registration, role } = await resolveCaller(body.carrierId, body.telegramUserId);
    takeReadToken(body.carrierId);
    const cardNumber =
      role === 'driver'
        ? await requireDriverCardNumber(registration)
        : await resolveCardByLast6(body.carrierId, body.cardLast6 ?? '');
    await dmOrThrow(registration, `🔑 Manual entry code (card •••• ${cardNumber.slice(-6)}):\n${cardNumber}`);
    await auditFromContext(telegramCtx(registration.profile, registration.telegramUserId), {
      action: 'carrier.support_bot.manual_code',
      status: 'ok',
      resourceType: 'efs_card',
      resourceId: cardNumber.slice(-6),
      detail: { carrierId: body.carrierId, role, via: 'support-bot' },
    });
    return { success: true, deliveredTo: 'private_bot_chat', last6: cardNumber.slice(-6) };
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
    const mock = !isProduction && env.FF_DEV_MOCK_TELEGRAM_ENABLED;
    // Fraud-only gate — same invariant as the mini-app override route (C-16).
    if (!mock) await efsWrapper.assertCardFraudHeld(body.carrierId, cardNumber);
    const result = mock
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
