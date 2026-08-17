/**
 * Marketing Mytrion backend — the Referral and Loyalty program endpoints.
 *
 * These were `/v1/manager/*` behind the `management` department until Referrals and Loyalty moved out
 * of the Manager hub into their own Mytrion. They were re-prefixed rather than aliased: leaving the
 * old paths alive would have left `management` as a standing second key into Marketing data, which is
 * exactly what moving them was meant to stop.
 *
 * Every route is marketing-gated — admins / all-department / bypass pass, otherwise the caller needs
 * the `marketing` department. Writes additionally require FULL (not read-only) Marketing access via
 * the generic `requireMytrionWrite`, which works here without a bespoke guard only because
 * marketing's Mytrion id EQUALS its department slug; `manager` maps to `management`, which is why it
 * needed a hand-written one.
 *
 * The endpoint is the real security boundary regardless of any per-tab UI gating in the frontend.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError, errorMessage, ValidationError } from '../../lib/errors.js';
import {
  LOYALTY_REWARD_IDS,
  type LoyaltyEnterpriseMode,
  type LoyaltyRewardId,
} from '../../db/schema/index.js';
import { requireDepartment, requireMytrionWrite } from './helpers.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { fetchLoyaltyRoster } from '../../modules/manager/loyaltyRoster.js';
import { fetchLoyaltyMonthRoster } from '../../modules/manager/loyaltyMonthRoster.js';
import { loyaltyOverrideView } from '../../modules/manager/loyaltyOverrides.js';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import { loyaltyClientOverrideRepo } from '../../repos/loyaltyClientOverrideRepo.js';
import { monthStart } from '../../modules/manager/referralBonusEngine.js';
import {
  fetchReferralAssociations,
  fetchReferralRecords,
  isReferralModuleKey,
} from '../../modules/manager/referralRecords.js';
import {
  REFERRAL_PERIOD_MAX_MONTHS,
  referralMonthSpan,
} from '../../modules/manager/referralPeriodRange.js';
import { fetchReferralWorkspace } from '../../modules/manager/referralWorkspace.js';

/** Marketing tab access gate — internal audience + admin/all-dept/bypass/`marketing` department. */
function requireMarketingAccess(request: FastifyRequest): TenantContext {
  return requireDepartment(request, 'marketing', 'Marketing');
}

/** Read + full-access gate in one. Covers `requireMarketingAccess`, so writes need only this. */
function requireMarketingWrite(request: FastifyRequest): TenantContext {
  return requireMytrionWrite(request, 'marketing', 'Loyalty overrides');
}

const carrierParams = z.object({ carrierId: z.string().trim().min(1).max(40) });
const loyaltyOverrideBody = z
  .object({
    companyName: z.string().trim().min(1).max(240),
    enterpriseMode: z.enum(['normal_billing', 'volume_target']).nullable(),
    enterpriseGoldTargetGallons: z.number().positive().max(10_000_000).nullable(),
    enabledRewardIds: z.array(z.enum(LOYALTY_REWARD_IDS)).max(LOYALTY_REWARD_IDS.length).nullable(),
    note: z.string().trim().max(1000).nullable(),
  })
  .superRefine((value, ctx) => {
    if (value.enterpriseMode === 'volume_target' && value.enterpriseGoldTargetGallons === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['enterpriseGoldTargetGallons'],
        message: 'Enterprise volume target requires a Gold gallon target',
      });
    }
    if (
      value.enabledRewardIds &&
      new Set(value.enabledRewardIds).size !== value.enabledRewardIds.length
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['enabledRewardIds'],
        message: 'Reward selections must be unique',
      });
    }
  });

export async function marketingRoutes(app: FastifyInstance): Promise<void> {
  const guard = { onRequest: [app.sessionOrApiKey] };

  // Complete card + modal read model. Static route must be registered before `:module`.
  app.get('/marketing/referrals/workspace', guard, async (request) => {
    const ctx = requireMarketingAccess(request);
    const monthStartToken = z.string().regex(/^\d{4}-\d{2}-01$/);
    const query = z
      .object({
        period_month: monthStartToken.optional(),
        period_from: monthStartToken.optional(),
        period_to: monthStartToken.optional(),
        refresh: z.enum(['1']).optional(),
      })
      .superRefine((value, refineCtx) => {
        if ((value.period_from == null) !== (value.period_to == null)) {
          refineCtx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'period_from and period_to are required together',
          });
        }
        if (value.period_from && value.period_to && value.period_from > value.period_to) {
          refineCtx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'period_from must be on or before period_to',
          });
        }
        if (
          value.period_from &&
          value.period_to &&
          referralMonthSpan(value.period_from, value.period_to) > REFERRAL_PERIOD_MAX_MONTHS
        ) {
          refineCtx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Referral range cannot exceed ${REFERRAL_PERIOD_MAX_MONTHS} months`,
          });
        }
      })
      .parse(request.query);
    const periodFrom =
      query.period_from ?? query.period_month ?? monthStart(new Date());
    const periodTo = query.period_to ?? periodFrom;
    return fetchReferralWorkspace(ctx, periodFrom, {
      force: query.refresh === '1',
      periodTo,
    });
  });

  // Referrals card — full-field records of a referral module via COQL. `:module` is a safe token
  // (parents|children); `?limit` optionally bounds the otherwise complete module drain.
  app.get('/marketing/referrals/:module', guard, async (request) => {
    requireMarketingAccess(request);
    const raw = (request.params as { module?: string }).module ?? '';
    if (!isReferralModuleKey(raw)) {
      throw new ValidationError(
        `Unknown referral module '${raw}' (expected 'parents' or 'children').`,
      );
    }
    const limitRaw = (request.query as { limit?: string }).limit;
    const limit = limitRaw != null && limitRaw !== '' ? Number(limitRaw) : undefined;
    return fetchReferralRecords(raw, limit);
  });

  // Leads/Deals that reference a referral (Parent_Referrer / Child_Referrer) — grouped by the card.
  app.get('/marketing/referral-links', guard, async (request) => {
    requireMarketingAccess(request);
    const limitRaw = (request.query as { limit?: string }).limit;
    const limit = limitRaw != null && limitRaw !== '' ? Number(limitRaw) : undefined;
    return fetchReferralAssociations(limit);
  });

  // Loyalty Program card — EVERY carrier's tier inputs (active cards + monthly gallons), agent-agnostic.
  // Same DWH query as Sales' Data Center → Clients, minus the owner filter, so the two surfaces can
  // never disagree on a client's tier. Not owner-scoped, hence manager-gated like every route here.
  app.get('/marketing/loyalty/clients', guard, async (request) => {
    const ctx = requireMarketingAccess(request);
    const query = z.object({ refresh: z.enum(['1']).optional() }).parse(request.query);
    try {
      return await fetchLoyaltyRoster(ctx, { force: query.refresh === '1' });
    } catch (error) {
      throw new AppError(`Loyalty data is temporarily unavailable: ${errorMessage(error)}`, {
        statusCode: 502,
        code: 'LOYALTY_DATA_UNAVAILABLE',
        expose: true,
        cause: error,
      });
    }
  });

  /**
   * Loyalty Program EXPORT — the same program as `/loyalty/clients`, measured against a chosen month
   * instead of against today: for month M the tier comes from M-1 and the reported activity is M's.
   *
   * A SEPARATE route rather than a `?month=` on the board read, deliberately. The board's contract is
   * "the tier in force right now" and its projection is pinned by a test to exactly the fields the
   * board renders; a month parameter would make that endpoint answer two different questions and
   * make "prevMonth" mean either "last month" or "the month before the one you asked for" depending
   * on a query string. The windows here are named by role (`basis*` / `month*`) for the same reason.
   *
   * AUDITED, unlike the board read. This is a bulk extract of the entire company book — every
   * carrier, its agent and its fuel volumes — leaving the building as a file. Who pulled which month
   * is the record worth having; the board read is a screen someone looked at.
   */
  app.get('/marketing/loyalty/export', guard, async (request) => {
    const ctx = requireMarketingAccess(request);
    const query = z
      .object({
        month: z
          .string()
          .trim()
          .regex(/^\d{4}-\d{2}-01$/, 'month must be the first of a month as YYYY-MM-01'),
        refresh: z.enum(['1']).optional(),
      })
      .parse(request.query);
    let roster;
    try {
      roster = await fetchLoyaltyMonthRoster(ctx, query.month, { force: query.refresh === '1' });
    } catch (error) {
      // A rejected month is the caller's error and must stay a 400 — only warehouse failures are 502.
      if (error instanceof ValidationError) throw error;
      throw new AppError(`Loyalty data is temporarily unavailable: ${errorMessage(error)}`, {
        statusCode: 502,
        code: 'LOYALTY_DATA_UNAVAILABLE',
        expose: true,
        cause: error,
      });
    }
    await auditFromContext(ctx, {
      action: 'marketing.loyalty.export.read',
      status: 'ok',
      resourceType: 'loyalty_month',
      resourceId: roster.month,
      detail: {
        month: roster.month,
        basisMonth: roster.basisMonth,
        monthComplete: roster.monthComplete,
        carriers: roster.total,
      },
    });
    return roster;
  });

  app.patch('/marketing/loyalty/clients/:carrierId/rewards', guard, async (request) => {
    const ctx = requireMarketingWrite(request);
    const { carrierId } = carrierParams.parse(request.params);
    const body = loyaltyOverrideBody.parse(request.body);
    const enterpriseMode = body.enterpriseMode as LoyaltyEnterpriseMode | null;
    const enabledRewardIds = body.enabledRewardIds as LoyaltyRewardId[] | null;
    const saved = await loyaltyClientOverrideRepo.upsert(ctx, {
      carrierId,
      companyName: body.companyName,
      enterpriseMode,
      enterpriseGoldTargetGallons:
        enterpriseMode === 'volume_target' && body.enterpriseGoldTargetGallons !== null
          ? body.enterpriseGoldTargetGallons.toFixed(2)
          : null,
      enabledRewardIds,
      note: body.note || null,
      updatedBy: ctx.userName ?? ctx.userId,
    });
    await auditFromContext(ctx, {
      action: 'marketing.loyalty.override.save',
      status: 'ok',
      resourceType: 'carrier',
      resourceId: carrierId,
      detail: {
        enterpriseMode,
        enterpriseGoldTargetGallons: body.enterpriseGoldTargetGallons,
        enabledRewardIds,
      },
    });
    return { override: loyaltyOverrideView(saved) };
  });

  app.delete('/marketing/loyalty/clients/:carrierId/rewards', guard, async (request) => {
    const ctx = requireMarketingWrite(request);
    const { carrierId } = carrierParams.parse(request.params);
    const removed = await loyaltyClientOverrideRepo.remove(ctx, carrierId);
    await auditFromContext(ctx, {
      action: 'marketing.loyalty.override.reset',
      status: 'ok',
      resourceType: 'carrier',
      resourceId: carrierId,
      detail: { removed },
    });
    return { removed };
  });
}
