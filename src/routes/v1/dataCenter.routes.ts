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
import { AppError, RBACError } from '../../lib/errors.js';
import {
  fetchAgentApplicationStats,
  fetchAgentDeals,
  fetchAgentLeads,
  fetchDealOwnerId,
  fetchLeadOwnerId,
} from '../../integrations/salesDataCenter.js';
import { fetchAgentClients } from '../../integrations/dwhClientRoster.js';
import { listRejectionReportTickets } from '../../integrations/zohoDesk.js';
import { zohoCrmRecords } from '../../integrations/zohoCrmRecords.js';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import { resolveWritePayload } from '../../modules/customerService/fieldResolver.js';
import { resolveZohoUserId } from '../../modules/tools/serverCrmScope.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { requireDepartment } from './helpers.js';

/** Sales/admin gate (internal audience only, session-authoritative departments). */
function requireSalesAccess(request: FastifyRequest): TenantContext {
  return requireDepartment(request, 'sales', 'Data Center');
}

const scopeQuery = z.object({ zoho_user_id: z.string().max(120).optional() });

const idParam = z.object({ id: z.string().regex(/^\d+$/, 'id must be a CRM record id').max(60) });

/** An email that may be a valid address, an empty string (clears the field), or null. */
const editableEmail = z.union([z.string().email().max(100), z.string().max(0)]).nullable().optional();

/**
 * Inline-editable Lead fields (live-verified API names/types against `/settings/fields`). `.strict()`
 * so an unexpected key 400s; every field optional+nullable (null/'' clears it); `resolveWritePayload`
 * casing-resolves before the write so an unknown key can never silently no-op.
 */
const leadEditBody = z
  .object({
    MC: z.string().max(255).nullable().optional(),
    DOT: z.union([z.number().int(), z.string().regex(/^\d{0,9}$/)]).nullable().optional(),
    Referral_Source: z.string().max(255).nullable().optional(),
    Cell: z.string().max(30).nullable().optional(),
    Phone: z.string().max(30).nullable().optional(),
    Email: editableEmail,
    Description: z.string().max(32000).nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'no editable fields supplied');

/** Inline-editable Deal fields (Description = the "Notes" textarea; deal value is intentionally not editable). */
const dealEditBody = z
  .object({
    Email: editableEmail,
    Phone: z.string().max(30).nullable().optional(),
    Description: z.string().max(32000).nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'no editable fields supplied');

function crmError(err: unknown): AppError {
  return new AppError('Zoho CRM request failed', {
    statusCode: 502,
    code: 'ZOHO_CRM_ERROR',
    cause: err,
    expose: true,
  });
}

/** Same shape as crmError but attributed to the DWH (the clients roster source is the warehouse, not CRM). */
function dwhError(err: unknown): AppError {
  return new AppError('Data warehouse request failed', {
    statusCode: 502,
    code: 'DWH_ERROR',
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
   * The caller's applications-filled-per-day counts (CRM Deals `Application_Date` — the
   * "application filled" date) over the trailing window — Home daily-goal bar + streak.
   * Owner-scoped like Leads/Deals; pass ?zoho_user_id when acting-as / admin targeting.
   */
  app.get('/data-center/app-stats', guard, async (request) => {
    const ctx = requireSalesAccess(request);
    const q = scopeQuery.parse(request.query);
    const ownerId = resolveZohoUserId(ctx, q.zoho_user_id);
    try {
      const stats = await fetchAgentApplicationStats(ownerId);
      request.log.debug(
        { ownerId, total: stats.total, days: Object.keys(stats.days).length },
        'data-center app-stats',
      );
      return stats;
    } catch (err) {
      throw crmError(err);
    }
  });

  /**
   * The caller's full client roster — carrier metadata + computed debt/activity overlays + cycle /
   * this-month / prev-month gallons, in ONE DWH query (dim_company + mart_transaction_line_items +
   * cmp_invoice). This is the sole source the Clients tab needs: it replaced the servercrm by-agent
   * roster (+ its live-CMP overlay) and the separate loyalty query. Owner-scoped like Leads/Deals.
   *
   * Owner→carrier matching mirrors servercrm's by-agent (id-suffix OR display name), so we return the
   * SAME carriers. The name arm needs the caller's display name: pass it for the self case (and an
   * act-as-by-header session, where ctx.userName is already the target). An admin targeting ANOTHER
   * agent via ?zoho_user_id uses the id path only — we don't have that agent's name.
   */
  app.get('/data-center/clients', guard, async (request) => {
    const ctx = requireSalesAccess(request);
    const q = scopeQuery.parse(request.query);
    const ownerId = resolveZohoUserId(ctx, q.zoho_user_id);
    const targetingOther = ctx.allDepartmentAccess && Boolean(q.zoho_user_id?.trim());
    const ownerName = targetingOther ? undefined : ctx.userName?.trim() || undefined;
    try {
      const clients = await fetchAgentClients(ownerId, ownerName);
      return { clients };
    } catch (err) {
      throw dwhError(err);
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

  /**
   * Owner-scoped inline edit of a CRM record (Lead/Deal). Mirrors the cs/billing deal-write pattern
   * (allowlist → casing-resolve → updateRecord → audit) but adds the Owner check the department-wide
   * cs/billing routes skip: a non-admin may only edit records they own, and an admin acting-as an
   * agent (?zoho_user_id) is confined to that agent's records — keeping writes scoped exactly like the
   * reads (RBAC rule #9). `bypassRbac` (system) short-circuits the ownership check.
   */
  async function ownerScopedUpdate(
    request: FastifyRequest,
    module: 'Leads' | 'Deals',
    body: Record<string, unknown>,
    fetchOwner: (id: string) => Promise<string | null>,
  ): Promise<{ id: string; updatedFields: string[] }> {
    const ctx = requireSalesAccess(request);
    const { id } = idParam.parse(request.params);
    const q = scopeQuery.parse(request.query);
    const targetOwner = resolveZohoUserId(ctx, q.zoho_user_id);
    if (!ctx.bypassRbac) {
      let recordOwner: string | null;
      try {
        recordOwner = await fetchOwner(id);
      } catch (err) {
        throw crmError(err);
      }
      if (!recordOwner) {
        throw new AppError('Record not found', { statusCode: 404, code: 'NOT_FOUND', expose: true });
      }
      if (recordOwner !== targetOwner) {
        throw new RBACError('You can only edit your own records');
      }
    }
    // Normalize '' → null (Zoho clears a field on null, not on empty string) and drop undefined keys.
    const payload = Object.fromEntries(
      Object.entries(body)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, v === '' ? null : v]),
    );
    if (Object.keys(payload).length === 0) {
      throw new AppError('No editable fields supplied', { statusCode: 400, code: 'NO_FIELDS', expose: true });
    }
    const resolved = await resolveWritePayload(module, payload);
    try {
      await zohoCrmRecords.updateRecord(module, id, resolved);
    } catch (err) {
      throw crmError(err);
    }
    await auditFromContext(ctx, {
      action: module === 'Leads' ? 'sales.datacenter.lead_update' : 'sales.datacenter.deal_update',
      status: 'ok',
      resourceType: module === 'Leads' ? 'crm_lead' : 'crm_deal',
      resourceId: id,
      detail: { fields: Object.keys(resolved) },
    });
    return { id, updatedFields: Object.keys(resolved) };
  }

  /** Edit an owned Lead's contact/qualification fields (MC/DOT/Referral/Cell/Phone/Email/Notes). */
  app.patch('/data-center/leads/:id', guard, async (request) => {
    const body = leadEditBody.parse(request.body);
    return ownerScopedUpdate(request, 'Leads', body, fetchLeadOwnerId);
  });

  /** Edit an owned Deal's contact fields (Email/Phone/Notes). */
  app.patch('/data-center/deals/:id', guard, async (request) => {
    const body = dealEditBody.parse(request.body);
    return ownerScopedUpdate(request, 'Deals', body, fetchDealOwnerId);
  });
}
