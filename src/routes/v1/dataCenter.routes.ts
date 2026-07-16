/**
 * Sales Data Center (/v1/data-center) — the Sales Mytrion "Data Center" tab's Leads / Deals
 * (Zoho CRM via COQL) and Rejections (Zoho Desk "Rejection Report" tickets).
 *
 * Leads/Deals are session-authoritative: scoped to the caller's own CRM user id (the record Owner)
 * via resolveZohoUserId — a non-admin only sees their own pipeline; an admin (or act-as) may pass
 * ?zoho_user_id. Rejections are org-wide system reports. Reads require the sales department (or
 * admin). All read-only.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { fetchAgentDeals, fetchAgentLeads } from '../../integrations/salesDataCenter.js';
import { listRejectionReportTickets } from '../../integrations/zohoDesk.js';
import { resolveZohoUserId } from '../../modules/tools/serverCrmScope.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { requireDepartment } from './helpers.js';

/** Sales/admin gate (internal audience only, session-authoritative departments). */
function requireSalesAccess(request: FastifyRequest): TenantContext {
  return requireDepartment(request, 'sales', 'Data Center');
}

const scopeQuery = z.object({ zoho_user_id: z.string().max(120).optional() });

function crmError(err: unknown): AppError {
  return new AppError('Zoho CRM request failed', {
    statusCode: 502,
    code: 'ZOHO_CRM_ERROR',
    cause: err,
    expose: true,
  });
}

export async function dataCenterRoutes(app: FastifyInstance): Promise<void> {
  const guard = { onRequest: [app.sessionOrApiKey] };

  /** The caller's own Leads (admins may target another agent via ?zoho_user_id). */
  app.get('/data-center/leads', guard, async (request) => {
    const ctx = requireSalesAccess(request);
    const q = scopeQuery.parse(request.query);
    const ownerId = resolveZohoUserId(ctx, q.zoho_user_id);
    try {
      const leads = await fetchAgentLeads(ownerId);
      return { leads };
    } catch (err) {
      throw crmError(err);
    }
  });

  /** The caller's own Deals. */
  app.get('/data-center/deals', guard, async (request) => {
    const ctx = requireSalesAccess(request);
    const q = scopeQuery.parse(request.query);
    const ownerId = resolveZohoUserId(ctx, q.zoho_user_id);
    try {
      const deals = await fetchAgentDeals(ownerId);
      return { deals };
    } catch (err) {
      throw crmError(err);
    }
  });

  /**
   * Rejection reports — the auto-created "Rejection Report: …" tickets from Zoho Desk (there is no
   * Desk custom module for these; they're ordinary tickets keyed by subject). Org-wide (they're
   * system reports, not owner-scoped), returned newest-first within the recent window.
   */
  app.get('/data-center/rejections', guard, async (request) => {
    requireSalesAccess(request);
    try {
      const rejections = await listRejectionReportTickets();
      return { rejections };
    } catch (err) {
      throw crmError(err);
    }
  });
}
