/**
 * Manager Mytrion backend — the "management" department's card-hub endpoints. Each Manager card
 * gets its own route(s) here; the first card is Referrals (a read-only browser over the two Zoho
 * referral modules). Every route is manager-gated: admins / all-department / bypass pass, otherwise
 * the caller needs the `management` department. The Mytrion→department map is `manager` →
 * `management` (src/lib/mytrions.ts), and the endpoint is the real security boundary regardless of
 * any per-card UI gating in the frontend.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { RBACError, ValidationError } from '../../lib/errors.js';
import {
  LOYALTY_REWARD_IDS,
  type LoyaltyEnterpriseMode,
  type LoyaltyRewardId,
} from '../../db/schema/index.js';
import { requireDepartment } from './helpers.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { fetchLoyaltyRoster } from '../../modules/manager/loyaltyRoster.js';
import { loyaltyOverrideView } from '../../modules/manager/loyaltyOverrides.js';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import { loyaltyClientOverrideRepo } from '../../repos/loyaltyClientOverrideRepo.js';
import { monthStart } from '../../modules/manager/referralBonusEngine.js';
import {
  fetchReferralAssociations,
  fetchReferralRecords,
  isReferralModuleKey,
} from '../../modules/manager/referralRecords.js';
import { fetchReferralWorkspace } from '../../modules/manager/referralWorkspace.js';

/** Manager card access gate — internal audience + admin/all-dept/bypass/`management` department. */
function requireManagerAccess(request: FastifyRequest): TenantContext {
  return requireDepartment(request, 'management', 'Manager');
}

function requireManagerWrite(request: FastifyRequest): TenantContext {
  const ctx = requireManagerAccess(request);
  if (
    ctx.role !== 'admin' &&
    !ctx.allDepartmentAccess &&
    !ctx.bypassRbac &&
    ctx.mytrionAccessModes?.manager === 'read'
  ) {
    throw new RBACError('Loyalty overrides require full Manager access');
  }
  return ctx;
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

export async function managerRoutes(app: FastifyInstance): Promise<void> {
  const guard = { onRequest: [app.sessionOrApiKey] };

  // Complete card + modal read model. Static route must be registered before `:module`.
  app.get('/manager/referrals/workspace', guard, async (request) => {
    const ctx = requireManagerAccess(request);
    const query = z
      .object({
        period_month: z
          .string()
          .regex(/^\d{4}-\d{2}-01$/)
          .optional(),
      })
      .parse(request.query);
    return fetchReferralWorkspace(ctx, query.period_month ?? monthStart(new Date()));
  });

  // Referrals card — full-field records of a referral module via COQL. `:module` is a safe token
  // (parents|children); `?limit` optionally bounds the otherwise complete module drain.
  app.get('/manager/referrals/:module', guard, async (request) => {
    requireManagerAccess(request);
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
  app.get('/manager/referral-links', guard, async (request) => {
    requireManagerAccess(request);
    const limitRaw = (request.query as { limit?: string }).limit;
    const limit = limitRaw != null && limitRaw !== '' ? Number(limitRaw) : undefined;
    return fetchReferralAssociations(limit);
  });

  // Loyalty Program card — EVERY carrier's tier inputs (active cards + monthly gallons), agent-agnostic.
  // Same DWH query as Sales' Data Center → Clients, minus the owner filter, so the two surfaces can
  // never disagree on a client's tier. Not owner-scoped, hence manager-gated like every route here.
  app.get('/manager/loyalty/clients', guard, async (request) => {
    const ctx = requireManagerAccess(request);
    return fetchLoyaltyRoster(ctx);
  });

  app.patch('/manager/loyalty/clients/:carrierId/rewards', guard, async (request) => {
    const ctx = requireManagerWrite(request);
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
      action: 'manager.loyalty.override.save',
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

  app.delete('/manager/loyalty/clients/:carrierId/rewards', guard, async (request) => {
    const ctx = requireManagerWrite(request);
    const { carrierId } = carrierParams.parse(request.params);
    const removed = await loyaltyClientOverrideRepo.remove(ctx, carrierId);
    await auditFromContext(ctx, {
      action: 'manager.loyalty.override.reset',
      status: 'ok',
      resourceType: 'carrier',
      resourceId: carrierId,
      detail: { removed },
    });
    return { removed };
  });
}
