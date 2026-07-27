/**
 * Manager Mytrion backend — the "management" department's card-hub endpoints. Each Manager card
 * gets its own route(s) here; the first card is Referrals (a read-only browser over the two Zoho
 * referral modules). Every route is manager-gated: admins / all-department / bypass pass, otherwise
 * the caller needs the `management` department. The Mytrion→department map is `manager` →
 * `management` (src/lib/mytrions.ts), and the endpoint is the real security boundary regardless of
 * any per-card UI gating in the frontend.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ValidationError } from '../../lib/errors.js';
import { requireDepartment } from './helpers.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { fetchLoyaltyRoster } from '../../modules/manager/loyaltyRoster.js';
import {
  fetchReferralAssociations,
  fetchReferralRecords,
  isReferralModuleKey,
} from '../../modules/manager/referralRecords.js';

/** Manager card access gate — internal audience + admin/all-dept/bypass/`management` department. */
function requireManagerAccess(request: FastifyRequest): TenantContext {
  return requireDepartment(request, 'management', 'Manager');
}

export async function managerRoutes(app: FastifyInstance): Promise<void> {
  const guard = { onRequest: [app.sessionOrApiKey] };

  // Referrals card — full-field records of a referral module via COQL. `:module` is a safe token
  // (parents|children); `?limit` overrides the default fetch size (200, COQL-capped at 2000).
  app.get('/manager/referrals/:module', guard, async (request) => {
    requireManagerAccess(request);
    const raw = (request.params as { module?: string }).module ?? '';
    if (!isReferralModuleKey(raw)) {
      throw new ValidationError(`Unknown referral module '${raw}' (expected 'parents' or 'children').`);
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
    requireManagerAccess(request);
    return fetchLoyaltyRoster();
  });
}
