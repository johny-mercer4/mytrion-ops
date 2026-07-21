/**
 * Write-action endpoints for the Telegram carrier mini-app — the self-service automations the
 * agent widget already runs (zoho-octane automations-catalog C-codes), exposed to the carrier's
 * own verified Telegram identity:
 *
 *   C-16 override        POST /carrier/mini-app/card/override      owner (own card) / driver (own card)
 *   C-1 / C-3 status     POST /carrier/mini-app/card/set-status    owner only
 *   C-4 / C-5 limits     POST /carrier/mini-app/card/limits        owner only (server-clamped)
 *   C-26 unit/driver     POST /carrier/mini-app/card/info          owner only
 *   C-10 fraud hold/rel  POST /carrier/mini-app/card/fraud-request owner only (raises a request, no direct EFS)
 *   C-17 money code      POST /carrier/mini-app/money-code/preview + /draw   owner only
 *   diagnostics read     POST /carrier/mini-app/card/efs           owner (any own card) / driver (own card)
 *
 * Why this does not violate CLAUDE.md rule 7 ("write → admin role"): the authority here is not
 * open-ended. Every write (a) targets a card the DWH proves belongs to the CALLER'S OWN carrier,
 * (b) goes to servercrm endpoints that enforce their own invariants (override only on Hold + EFS
 * auto-reverts in ~30min; money-code draw limits are computed server-side in servercrm), (c) is
 * feature-flagged off by default, (d) is rate-limited per carrier, and (e) is audit-logged. The
 * card is NEVER taken from the request body as a raw number — owners send an opaque cardId that is
 * resolved against the DWH, drivers are pinned to their registered card (fail-closed).
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError, NotFoundError } from '../../lib/errors.js';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import { env, isProduction } from '../../config/env.js';
import { findDwhCardById } from '../../integrations/dwhCards.js';
import { takeToken } from '../../modules/security/rateBucket.js';
import { efsWrapper } from '../../wrappers/efsWrapper.js';
import { serverCrmWrapper } from '../../wrappers/serverCrmWrapper.js';
import { notifyMiniApp } from '../../modules/notifications/service.js';
import {
  requireDriverCardNumber,
  requireRegisteredCarrierUser,
  requireRegisteredOwnerUser,
  telegramCtx,
} from '../../modules/carrier/miniAppAuth.js';
import type { RegisteredMiniAppCompany } from '../../db/schema/index.js';

const initDataSchema = z.object({ initData: z.string().min(1) });
const cardSchema = initDataSchema.extend({ cardId: z.string().min(1).max(120).optional() });
const setStatusSchema = initDataSchema.extend({
  cardId: z.string().min(1).max(120),
  action: z.enum(['activate', 'deactivate']),
});
const limitsSchema = initDataSchema.extend({
  cardId: z.string().min(1).max(120),
  /** EFS limit id, e.g. ULSD/DEFD gallons-per-day buckets. Passed through to servercrm verbatim. */
  limitId: z.string().min(1).max(40),
  value: z.coerce.number().positive(),
  action: z.enum(['increase', 'decrease']),
});
const cardInfoSchema = initDataSchema.extend({
  /** Owner picks a card; a DRIVER omits this — they are pinned to their own card. */
  cardId: z.string().min(1).max(120).optional(),
  unitNumber: z.string().trim().max(60).optional(),
  driverId: z.string().trim().max(60).optional(),
  driverName: z.string().trim().max(200).optional(),
});
const fraudRequestSchema = initDataSchema.extend({
  cardId: z.string().min(1).max(120),
  request: z.enum(['fraud_hold', 'fraud_release']),
});
const moneyCodeDrawSchema = initDataSchema.extend({
  amount: z.coerce.number().positive(),
  unitNumber: z.string().trim().min(1).max(60),
  reason: z.string().trim().min(1).max(120),
});

/** Per-carrier sliding-window cap on write attempts — a stuck client retry loop must not hammer EFS. */
const WRITES_PER_MINUTE = 5;

function requireWritesEnabled(): void {
  if (!env.FF_MINIAPP_CARD_WRITES_ENABLED) {
    throw new AppError('This action is not enabled yet. Please send a request instead.', {
      statusCode: 503,
      code: 'MINIAPP_WRITES_DISABLED',
      expose: true,
    });
  }
}

function takeWriteToken(carrierId: string): void {
  if (!takeToken(`miniapp:write:${carrierId}`, WRITES_PER_MINUTE)) {
    throw new AppError('Too many changes at once — please wait a minute and try again.', {
      statusCode: 429,
      code: 'MINIAPP_WRITE_RATE_LIMITED',
      expose: true,
    });
  }
}

/**
 * Resolve the card this call may act on, by ROLE:
 *  - driver → their registered card, always (a body cardId is ignored — a driver must never aim an
 *    action at a colleague's card by editing the payload);
 *  - owner  → the body cardId, verified against the DWH as a card of the caller's OWN carrier.
 * Returns the real card number servercrm/EFS needs. Fail-closed on any miss.
 */
async function resolveActionCard(
  registration: RegisteredMiniAppCompany,
  carrierId: string,
  cardId: string | undefined,
): Promise<{ cardNumber: string; cardId: string }> {
  if (registration.profile === 'driver') {
    const cardNumber = await requireDriverCardNumber(registration);
    return { cardNumber, cardId: registration.cardId ?? '' };
  }
  if (!cardId) {
    throw new AppError('Pick which card this applies to', {
      statusCode: 400,
      code: 'CARD_ID_REQUIRED',
      expose: true,
    });
  }
  const card = await findDwhCardById(carrierId, cardId).catch(() => null);
  if (!card?.cardNumber) {
    throw new NotFoundError('That card was not found on your account');
  }
  return { cardNumber: card.cardNumber, cardId };
}

export async function carrierMiniAppActionsRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Diagnostics read — live EFS info for one card (status, hold flag, limits). Powers the
   * "My card isn't working" flow: status → limits → [override]. Read-only, so no write flag.
   */
  app.post('/carrier/mini-app/card/efs', async (request) => {
    const body = cardSchema.parse(request.body);
    const { registration, carrierId } = await requireRegisteredCarrierUser(body.initData);
    const { cardNumber } = await resolveActionCard(registration, carrierId, body.cardId);
    return efsWrapper.getCardEfsInfo(carrierId, cardNumber);
  });

  /**
   * C-16 — override a fraud-held card for the EFS-enforced ~30-minute window. The one write a
   * DRIVER may perform, because it is (a) pinned to their own card and (b) self-reverting.
   * servercrm 409s when the card is not on hold, so this cannot flip a healthy card's state.
   */
  app.post('/carrier/mini-app/card/override', async (request) => {
    requireWritesEnabled();
    const body = cardSchema.parse(request.body);
    const { registration, carrierId } = await requireRegisteredCarrierUser(body.initData);
    takeWriteToken(carrierId);
    const { cardNumber, cardId } = await resolveActionCard(registration, carrierId, body.cardId);
    const ctx = telegramCtx(registration.profile, registration.telegramUserId);
    // DEV ONLY — same explicit opt-in gate as the mock-init-data route: lets the full override UX
    // (button → toast → Home countdown → bot receipt → audit row) be clicked through locally
    // without a real fraud-held card. Impossible in production BY CONSTRUCTION (isProduction).
    const result =
      !isProduction && env.FF_DEV_MOCK_TELEGRAM_ENABLED
        ? { success: true, cardNumber, previousStatus: 'Hold', override: true, message: 'DEV MOCK — EFS not called' }
        : await efsWrapper.overrideCard(carrierId, cardNumber);
    await auditFromContext(ctx, {
      action: 'carrier.mini_app.card_override',
      status: 'ok',
      resourceType: 'efs_card',
      resourceId: cardId,
      detail: { carrierId, profile: registration.profile },
    });
    // Best-effort bot receipt: the ~30-min window matters at the PUMP, where the driver may close
    // the mini-app — a chat message (with the card's last 6) outlives the WebView. Goes through
    // the notification outbox (mini_app_notifications + pg-boss retries) — the first caller of
    // the platform notification layer. Never blocks or fails the override itself.
    void notifyMiniApp({
      type: 'override',
      tenantId: registration.tenantId,
      carrierId,
      telegramUserId: registration.telegramUserId,
      dedupeKey: `override:${carrierId}:${cardId}:${Date.now()}`,
      payload: { last6: cardNumber.slice(-6), cardId },
    });
    return result;
  });

  /** C-1 / C-3 — activate or deactivate a card. Owner-only: this is a durable state flip. */
  app.post('/carrier/mini-app/card/set-status', async (request) => {
    requireWritesEnabled();
    const body = setStatusSchema.parse(request.body);
    const { registration, carrierId } = await requireRegisteredOwnerUser(body.initData);
    takeWriteToken(carrierId);
    const { cardNumber } = await resolveActionCard(registration, carrierId, body.cardId);
    const ctx = telegramCtx(registration.profile, registration.telegramUserId);
    const result = await efsWrapper.setCardStatus(carrierId, cardNumber, body.action);
    await auditFromContext(ctx, {
      action: `carrier.mini_app.card_${body.action}`,
      status: 'ok',
      resourceType: 'efs_card',
      resourceId: body.cardId,
      detail: { carrierId },
    });
    return result;
  });

  /**
   * C-4 / C-5 — raise or lower a card limit. Owner-only, and the CHANGE amount is clamped
   * server-side (MINIAPP_LIMIT_CHANGE_MAX) so the mini-app cannot be used to set an unbounded
   * limit even by the account owner — larger changes go through CS as before.
   */
  app.post('/carrier/mini-app/card/limits', async (request) => {
    requireWritesEnabled();
    const body = limitsSchema.parse(request.body);
    if (body.value > env.MINIAPP_LIMIT_CHANGE_MAX) {
      throw new AppError(
        `Changes above ${env.MINIAPP_LIMIT_CHANGE_MAX} need a support request — please contact your rep.`,
        { statusCode: 422, code: 'LIMIT_CHANGE_TOO_LARGE', expose: true },
      );
    }
    const { registration, carrierId } = await requireRegisteredOwnerUser(body.initData);
    takeWriteToken(carrierId);
    const { cardNumber } = await resolveActionCard(registration, carrierId, body.cardId);
    const ctx = telegramCtx(registration.profile, registration.telegramUserId);
    const result = await efsWrapper.setCardLimits(carrierId, cardNumber, {
      limitId: body.limitId,
      value: body.value,
      action: body.action,
    });
    await auditFromContext(ctx, {
      action: 'carrier.mini_app.card_limits',
      status: 'ok',
      resourceType: 'efs_card',
      resourceId: body.cardId,
      detail: { carrierId, limitId: body.limitId, value: body.value, direction: body.action },
    });
    return result;
  });

  /** C-26 — unit number / driver id / driver name on the card, in EFS.
   *
   * Owner: any of the three fields, on any of their cards. DRIVER: their OWN card only, and only
   * `unitNumber` (they switch trucks — 'he is on unit 4031 right now' is a weekly chat ask) and
   * `driverId` (which IS the pump PIN prompt — this is the self-service "change my PIN" from the
   * SelfService spec). `driverName` stays owner-only: it is the roster label the OWNER reads. */
  app.post('/carrier/mini-app/card/info', async (request) => {
    requireWritesEnabled();
    const body = cardInfoSchema.parse(request.body);
    const fields = {
      ...(body.unitNumber ? { unitNumber: body.unitNumber } : {}),
      ...(body.driverId ? { driverId: body.driverId } : {}),
      ...(body.driverName ? { driverName: body.driverName } : {}),
    };
    if (!Object.keys(fields).length) {
      throw new AppError('Provide a unit number, driver ID, or driver name to change', {
        statusCode: 400,
        code: 'CARD_INFO_EMPTY',
        expose: true,
      });
    }
    const { registration, carrierId } = await requireRegisteredCarrierUser(body.initData);
    if (registration.profile === 'driver' && body.driverName) {
      throw new AppError('The driver name on the card is managed by your company owner', {
        statusCode: 403,
        code: 'DRIVER_NAME_OWNER_ONLY',
        expose: true,
      });
    }
    takeWriteToken(carrierId);
    const resolved = await resolveActionCard(registration, carrierId, body.cardId);
    const ctx = telegramCtx(registration.profile, registration.telegramUserId);
    const result = await efsWrapper.updateCardInfo(carrierId, resolved.cardNumber, fields);
    await auditFromContext(ctx, {
      action: 'carrier.mini_app.card_info_change',
      status: 'ok',
      resourceType: 'efs_card',
      resourceId: resolved.cardId,
      detail: { carrierId, profile: registration.profile, fields: Object.keys(fields) },
    });
    return result;
  });

  /**
   * C-10 — fraud hold / release REQUEST. Not a direct EFS action upstream either: servercrm
   * forwards to the fraud team's intake (Zapier fan-out), a human acts. Owner-only; still
   * rate-limited so the intake can't be flooded.
   */
  app.post('/carrier/mini-app/card/fraud-request', async (request) => {
    requireWritesEnabled();
    const body = fraudRequestSchema.parse(request.body);
    const { registration, carrierId } = await requireRegisteredOwnerUser(body.initData);
    takeWriteToken(carrierId);
    const { cardNumber } = await resolveActionCard(registration, carrierId, body.cardId);
    const ctx = telegramCtx(registration.profile, registration.telegramUserId);
    const result = await efsWrapper.fraudHoldRelease({
      carrierId,
      cardNumber,
      ticketType: body.request,
      companyName: registration.companyName ?? '',
      // The reachable identity: a Telegram registration has no email — the fraud team replies via
      // the same channel CS uses (see serviceRequest.ts describe()).
      agentEmail: `mini-app:telegram:${registration.telegramUserId}`,
    });
    await auditFromContext(ctx, {
      action: 'carrier.mini_app.fraud_request',
      status: 'ok',
      resourceType: 'efs_card',
      resourceId: body.cardId,
      detail: { carrierId, request: body.request },
    });
    return result;
  });

  // ── C-17 Money Code ─────────────────────────────────────────────────────────────────────────
  // servercrm is the source of truth for the drawable amount (a % of the latest invoice) and the
  // allowed reasons — the mini-app never invents a limit. The code value is NEVER returned to the
  // UI (same business rule as the agent widget): issuance/delivery is handled upstream.

  const requireMoneyCodeEnabled = (): void => {
    if (!env.FF_MINIAPP_MONEY_CODE_ENABLED) {
      throw new AppError('Money codes are not enabled here yet. Please send a request instead.', {
        statusCode: 503,
        code: 'MINIAPP_MONEY_CODE_DISABLED',
        expose: true,
      });
    }
  };

  app.post('/carrier/mini-app/money-code/preview', async (request) => {
    requireMoneyCodeEnabled();
    const body = initDataSchema.parse(request.body);
    const { carrierId } = await requireRegisteredOwnerUser(body.initData);
    return serverCrmWrapper.getMoneyCodePreview(carrierId);
  });

  app.post('/carrier/mini-app/money-code/draw', async (request) => {
    requireMoneyCodeEnabled();
    const body = moneyCodeDrawSchema.parse(request.body);
    const { registration, carrierId } = await requireRegisteredOwnerUser(body.initData);
    takeWriteToken(carrierId);
    const ctx = telegramCtx(registration.profile, registration.telegramUserId);
    try {
      const result = await serverCrmWrapper.drawMoneyCode(carrierId, {
        amount: body.amount,
        unitNumber: body.unitNumber,
        reason: body.reason,
        requestedBy: `mini-app: ${registration.companyName ?? 'owner'} (telegram:${registration.telegramUserId})`,
      });
      await auditFromContext(ctx, {
        action: 'carrier.mini_app.money_code_draw',
        status: 'ok',
        resourceType: 'money_code',
        resourceId: String(carrierId),
        detail: { carrierId, amount: body.amount, unitNumber: body.unitNumber, reason: body.reason },
      });
      // Inbox/bot receipt for the draw — the CODE VALUE never rides along (registry rule);
      // the message says "open the mini-app". Fire-and-forget through the outbox.
      void notifyMiniApp({
        type: 'money_code',
        tenantId: registration.tenantId,
        carrierId,
        telegramUserId: registration.telegramUserId,
        dedupeKey: `money_code:${carrierId}:${Date.now()}`,
        payload: { reason: body.reason ?? '' },
      });
      return result;
    } catch (err) {
      await auditFromContext(ctx, {
        action: 'carrier.mini_app.money_code_draw',
        status: 'error',
        resourceType: 'money_code',
        resourceId: String(carrierId),
        detail: { carrierId, amount: body.amount },
      });
      throw err;
    }
  });
}
