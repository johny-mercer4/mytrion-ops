/**
 * Sales Data Center (/v1/data-center) — the Sales Mytrion "Data Center" tab's Leads / Deals /
 * Rejections, read from Zoho CRM via COQL (auth + base URL from the Zoho wrapper).
 *
 * Identity is session-authoritative (same as the Desk routes): every pull is scoped to the
 * caller's own CRM user id (the record Owner) via resolveZohoUserId — a non-admin only ever sees
 * their own pipeline; an admin (or act-as) may pass ?zoho_user_id to view another agent's. Reads
 * require the sales department (or admin). All three endpoints are read-only (COQL SELECT).
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError, RBACError } from '../../lib/errors.js';
import {
  fetchAgentDeals,
  fetchAgentLeads,
  fetchAgentRejections,
} from '../../integrations/salesDataCenter.js';
import { resolveZohoUserId } from '../../modules/tools/serverCrmScope.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { requireContext, withDepartmentAccess } from './helpers.js';

/** Sales/admin gate (internal audience only) — mirrors the Desk routes' gate. */
function requireSalesAccess(request: FastifyRequest): TenantContext {
  const base = requireContext(request);
  if (base.audience !== 'internal') throw new RBACError('Data Center is internal-only');
  const ctx = withDepartmentAccess(base, request);
  const ok =
    ctx.role === 'admin' ||
    ctx.bypassRbac === true ||
    ctx.allDepartmentAccess ||
    ctx.departments.includes('sales');
  if (!ok) throw new RBACError('Data Center requires sales department access');
  return ctx;
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

  /** The caller's own rejected/declined Deals (the rejection report). */
  app.get('/data-center/rejections', guard, async (request) => {
    const ctx = requireSalesAccess(request);
    const q = scopeQuery.parse(request.query);
    const ownerId = resolveZohoUserId(ctx, q.zoho_user_id);
    try {
      const rejections = await fetchAgentRejections(ownerId);
      return { rejections };
    } catch (err) {
      throw crmError(err);
    }
  });
}
