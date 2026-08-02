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
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { env } from '../../config/env.js';
import { findDealOwnerForCarrier } from '../../integrations/dwhClients.js';
import { listDwhTransactions } from '../../integrations/dwhTransactions.js';
import { scopeRowsToCard } from '../../modules/carrier/driverCardScope.js';
import { listLiveCardRows as listCardsLive } from '../../modules/carrier/liveCards.js';
import { requireDriverCardNumber } from '../../modules/carrier/miniAppAuth.js';
import {
  resolveSupportBotCaller as resolveCaller,
  resolveSupportBotCardByLast6 as resolveCardByLast6,
  supportBotCallerSchema as callerSchema,
} from '../../modules/carrier/supportBotCaller.js';
import { executeZohoFunctionWithFallback } from '../../integrations/zohoFunctions.js';
import { takeToken } from '../../modules/security/rateBucket.js';
import { efsWrapper } from '../../wrappers/efsWrapper.js';
import { serverCrmWrapper } from '../../wrappers/serverCrmWrapper.js';
import { supportBotCardActionRoutes } from './supportBotCardAction.routes.js';
import { supportBotConfirmationRoutes } from './supportBotConfirmation.routes.js';
import { supportBotDocumentRoutes } from './supportBotDocuments.routes.js';
import { supportBotGatewayRoutes } from './supportBotGateway.routes.js';
import { supportBotGatewayLeaseRoutes } from './supportBotGatewayLease.routes.js';
import { supportBotPrivateRoutes } from './supportBotPrivate.routes.js';
import { supportBotMutationRoutes } from './supportBotMutation.routes.js';
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

export async function supportBotRoutes(app: FastifyInstance): Promise<void> {
  await supportBotCardActionRoutes(app);
  await supportBotConfirmationRoutes(app);
  await supportBotGatewayLeaseRoutes(app);

  await supportBotGatewayRoutes(app);
  await supportBotDocumentRoutes(app);
  await supportBotPrivateRoutes(app);
  await supportBotMutationRoutes(app);

  const guard = { onRequest: [app.supportBotGatewayAuth] };

  /** Who is asking — lets the bot address the person correctly and offer the right menu. */
  app.post('/support-bot/whoami', guard, async (request) => {
    const body = callerSchema.parse(request.body);
    const { registration, role } = await resolveCaller(requireContext(request), body.carrierId, body.telegramUserId);
    // Responsible sales agent = the LIVE deal owner from the DWH, NOT whoever created the
    // registration link (the invite-stamped agentName is the link creator on older records) and
    // NEVER the client. findDealOwnerForCarrier matches the carrier EXACTLY, keeps closed deals,
    // and falls back to dim_company when the Zoho deal row has no owner — so an active client like
    // ONZMOVE resolves instead of the old prefix/Closed-Lost search returning null. Best-effort:
    // null → the bot falls back to a generic "your Octane agent" (prompt rule).
    const agentName = await findDealOwnerForCarrier(body.carrierId).catch(() => null);
    return {
      role,
      name: registration.driverName ?? null,
      companyName: registration.companyName ?? null,
      agentName,
    };
  });

  /**
   * Card status. driver → their own card's row only; owner → account standing + per-card
   * statuses (capped, like the mini-app's status sheet).
   */
  app.post('/support-bot/card-status', guard, async (request) => {
    const body = callerSchema
      .extend({
        cardLast6: z.string().trim().min(4).max(19).optional(),
        // Narrow a big fleet without the old 30-card blind window (owner ask 2026-07-23):
        // query matches last6 / unit / driver; status filters active|inactive|hold.
        query: z.string().trim().max(60).optional(),
        status: z.enum(['active', 'inactive', 'hold']).optional(),
      })
      .parse(request.body);
    const { registration, role } = await resolveCaller(requireContext(request), body.carrierId, body.telegramUserId);
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
    // SPECIFIC card (owner asked about one card — usually a PHOTO): look it up across the WHOLE
    // fleet, never the 30-card window. The old summary made the bot GUESS "probably deactivated"
    // for any card past the first 30 (live incident 2026-07-23: card •••• 567876 was actually
    // 'Hold For Fraud', not deactivated — the bot guessed wrong). fraudHold/overrideAvailable let
    // the bot route to Override (one-time), the way a human agent answers, instead of "activate".
    if (body.cardLast6) {
      const want = body.cardLast6.replace(/\D/g, '').slice(-6);
      const match = cardRows.find((r) => String(r['card_number'] ?? '').replace(/\D/g, '').endsWith(want));
      if (!match) return { role, card: null, note: 'That card is not in this company fleet.' };
      const status = String(match['status'] ?? '');
      const fraudHold = /hold|fraud/i.test(status);
      return {
        role,
        card: {
          last6: String(match['card_number'] ?? '').slice(-6),
          status: match['status'] ?? null,
          unit: match['unit_number'] ?? null,
          driver: match['driver_name'] ?? null,
          fraudHold,
          // Override applies to a fraud hold (one-time usage); a plain deactivated card is NOT
          // overridable — the owner activates it instead.
          overrideAvailable: fraudHold || Number(match['override'] ?? 0) > 0,
          active: status.toLowerCase() === 'active',
        },
      };
    }
    // General fleet read. query / status narrow across the WHOLE fleet (returning unit + driver so
    // the bot can name a card); with neither, the full list is returned up to a safety cap so a
    // huge fleet can't blow the response — past the cap the bot is told to use query/status.
    const OWNER_CARD_CAP = 150;
    const activeCount = cardRows.filter((r) => String(r['status'] ?? '').toLowerCase() === 'active').length;
    const holdCount = cardRows.filter((r) => /hold|fraud/i.test(String(r['status'] ?? ''))).length;
    const nq = (body.query ?? '').toLowerCase();
    const nqDigits = nq.replace(/\D/g, '');
    const matched = cardRows.filter((r) => {
      if (body.status) {
        const st = String(r['status'] ?? '').toLowerCase();
        if (body.status === 'active' && !(st.includes('active') && !st.includes('inactive'))) return false;
        if (body.status === 'inactive' && !st.includes('inactive')) return false;
        if (body.status === 'hold' && !/hold|fraud/i.test(st)) return false;
      }
      if (!nq) return true;
      const hay = `${r['card_number'] ?? ''} ${r['unit_number'] ?? ''} ${r['driver_name'] ?? ''} ${r['driver_id'] ?? ''}`.toLowerCase();
      return hay.includes(nq) || (nqDigits.length > 0 && String(r['card_number'] ?? '').replace(/\D/g, '').includes(nqDigits));
    });
    const rows = matched.slice(0, OWNER_CARD_CAP).map((r) => ({
      last6: String(r['card_number'] ?? '').slice(-6),
      status: r['status'] ?? null,
      unit: r['unit_number'] ?? null,
      driver: r['driver_name'] ?? null,
    }));
    return {
      role,
      count: cardRows.length,
      matchCount: matched.length,
      activeCount,
      holdCount,
      cards: rows,
      truncated: matched.length > OWNER_CARD_CAP,
      note: matched.length > OWNER_CARD_CAP
        ? `Showing ${OWNER_CARD_CAP} of ${matched.length}. Narrow with query (last6/unit/driver) or status (active|inactive|hold); for ONE card pass cardLast6.`
        : 'For ONE specific card (e.g. a photo) pass cardLast6; to narrow, use query or status.',
    };
  });

  /**
   * Funds. owner → real figures (live EFS pool, credit fields). driver → boolean only —
   * the company's money is the owner's business (the mini-app /card/funds rule verbatim).
   */
  app.post('/support-bot/funds', guard, async (request) => {
    const body = callerSchema.parse(request.body);
    const { registration, role } = await resolveCaller(requireContext(request), body.carrierId, body.telegramUserId);
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
    const { registration, role } = await resolveCaller(requireContext(request), body.carrierId, body.telegramUserId);
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

  /** Card shipment tracking — owner read (68 chat asks). Same shape the mini-app uses. */
  app.post('/support-bot/tracking', guard, async (request) => {
    const body = callerSchema.parse(request.body);
    const { role } = await resolveCaller(requireContext(request), body.carrierId, body.telegramUserId);
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
   * Per-card LAST-USED date — the mini-app drv-last-used / fleet last-used, now over the bot.
   * Driver → own card; owner → whole fleet, or one card via cardLast6. No dollar figures, so the
   * bot may answer inline.
   */
  app.post('/support-bot/last-used', guard, async (request) => {
    const body = callerSchema
      .extend({ range: z.string().max(20).default('all_time'), cardLast6: z.string().trim().min(4).max(19).optional() })
      .parse(request.body);
    const { registration, role } = await resolveCaller(requireContext(request), body.carrierId, body.telegramUserId);
    takeReadToken(body.carrierId);
    const result = await serverCrmWrapper.getLastUsed(body.carrierId, body.range);
    let rows = (result.data ?? []) as Array<Record<string, unknown>>;
    if (role === 'driver') {
      rows = scopeRowsToCard(rows, await requireDriverCardNumber(registration));
    } else if (body.cardLast6) {
      rows = scopeRowsToCard(rows, await resolveCardByLast6(body.carrierId, body.cardLast6));
    }
    return { role, count: rows.length, cards: rows.slice(0, 50) };
  });

  /**
   * Owner billing-cycle + payment status (servercrm payment-info, ~90-day window) — the mini-app
   * fin-payment-status service. Owner-only. Carries dollar figures, so the bot keeps AMOUNTS to the
   * owner's private chat and says only status/dates in the group (same money-in-group rule).
   */
  app.post('/support-bot/payment', guard, async (request) => {
    const body = callerSchema.parse(request.body);
    const { role } = await resolveCaller(requireContext(request), body.carrierId, body.telegramUserId);
    if (role !== 'owner') {
      throw new AppError('Payment status is available to the account owner.', { statusCode: 403, code: 'SUPPORT_BOT_OWNER_ONLY', expose: true });
    }
    takeReadToken(body.carrierId);
    const payment = await serverCrmWrapper.getPaymentInfo(body.carrierId);
    return { role, payment, note: 'Dollar figures go to the owner PRIVATELY; in the group say only status/dates, never amounts.' };
  });

  /**
   * Owner billing form + verification status — the READ behind the mini-app doc-billing-form sheet
   * (Zoho mytrionfetchbillingforminfo). Owner-only. Distinct from octane_service_request(billing-form),
   * which FILES a form; this SHOWS the current one.
   */
  app.post('/support-bot/billing-form', guard, async (request) => {
    const body = callerSchema.parse(request.body);
    const { role } = await resolveCaller(requireContext(request), body.carrierId, body.telegramUserId);
    if (role !== 'owner') {
      throw new AppError('The billing form is available to the account owner.', { statusCode: 403, code: 'SUPPORT_BOT_OWNER_ONLY', expose: true });
    }
    takeReadToken(body.carrierId);
    try {
      const raw = await executeZohoFunctionWithFallback(
        ['mytrionfetchbillingforminfo', 'mytrionFetchBillingFormInfo'],
        { carrierId: body.carrierId },
        { unwrap: 'permissive' },
      );
      if (!raw || typeof raw !== 'object') return { role, verification: null, billingForm: null, notes: [] };
      const r = raw as Record<string, unknown>;
      const deal = (r['deal'] ?? null) as Record<string, unknown> | null;
      return {
        role,
        verification: deal?.['billingVerification'] ?? null,
        billingForm: (r['billingForm'] ?? null) as Record<string, unknown> | null,
        notes: Array.isArray(r['notes']) ? r['notes'] : [],
      };
    } catch (err) {
      throw new AppError('Billing form lookup failed', { statusCode: 502, code: 'BILLING_FORM_ERROR', expose: true, cause: err });
    }
  });

  /**
   * Money code — QUOTE (owner-only, read). Answers "qancha money code olsam bo'ladi?" and
   * fee-for-amount BEFORE a draw. The drawable window (limit) is servercrm's authoritative
   * getMoneyCodePreview — a % of the latest invoice (credit) or the prepaid balance — and is the
   * ONLY source of truth; the bot must NEVER invent a limit. The fee is the published EFS/WEX
   * schedule (KB-15): $3.50 per $500 increment (rounded up) + $0.75 per additional use of a code.
   */
  app.post('/support-bot/money-code/preview', guard, async (request) => {
    if (!env.FF_MINIAPP_MONEY_CODE_ENABLED) {
      throw new AppError('Money code is not enabled yet.', { statusCode: 503, code: 'MINIAPP_MONEY_CODE_DISABLED', expose: true });
    }
    const body = callerSchema.extend({ amount: z.coerce.number().positive().optional() }).parse(request.body);
    const { role } = await resolveCaller(requireContext(request), body.carrierId, body.telegramUserId);
    if (role !== 'owner') {
      throw new AppError('Money codes are issued by the account owner.', { statusCode: 403, code: 'SUPPORT_BOT_OWNER_ONLY', expose: true });
    }
    takeReadToken(body.carrierId);
    const preview = (await serverCrmWrapper.getMoneyCodePreview(body.carrierId)) as Record<string, unknown>;
    const num = (v: unknown): number | null => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
    const available = num(preview['available']);
    const drawn = num(preview['drawn']);
    const eligible = preview['eligible'] === true || preview['eligible'] === 'true' || (available != null && available > 0);
    const reasons = Array.isArray(preview['moneycode_reasons']) ? preview['moneycode_reasons'] : [];
    // Fee for a requested amount, if one was given. $3.50 per $500 increment (rounded up).
    const fee = (amount: number) => {
      const increments = Math.max(1, Math.ceil(amount / 500));
      return { amount, fee: increments * 3.5, increments, perUse: 0.75 };
    };
    const quote =
      body.amount != null
        ? {
            ...fee(body.amount),
            withinLimit: available == null ? null : body.amount <= available,
          }
        : null;
    return {
      role,
      eligible,
      available, // max drawable RIGHT NOW — authoritative; never invent a limit
      drawn,
      reasons,
      ...(quote ? { quote } : {}),
      feeSchedule: { perIncrementUsd: 3.5, incrementUsd: 500, additionalUseUsd: 0.75 },
      note: '`available` is the ONLY limit source. Fee = $3.50 per $500 (rounded up) + $0.75 per additional use of a code. Amounts may be spoken to the OWNER; the code value itself never goes to the group.',
    };
  });

}
