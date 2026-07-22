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
import { listClientCards, getClientBilling } from '../../integrations/dwhCards.js';
import { listRejectionReportTickets } from '../../integrations/zohoDesk.js';
import { zohoCrmRecords } from '../../integrations/zohoCrmRecords.js';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import { resolveWritePayload } from '../../modules/customerService/fieldResolver.js';
import { resolveActAsTarget } from '../../modules/auth/actAsDirectory.js';
import { assertCarrierOwned, resolveZohoUserId } from '../../modules/tools/serverCrmScope.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { requireDepartment } from './helpers.js';

/** Sales/admin gate (internal audience only, session-authoritative departments). */
function requireSalesAccess(request: FastifyRequest): TenantContext {
  return requireDepartment(request, 'sales', 'Data Center');
}

const scopeQuery = z.object({ zoho_user_id: z.string().max(120).optional() });

const carrierCardsQuery = z.object({ carrierId: z.string().regex(/^\d+$/, 'carrierId must be numeric').max(20) });

const idParam = z.object({ id: z.string().regex(/^\d+$/, 'id must be a CRM record id').max(60) });

/** An email that may be a valid address, an empty string (clears the field), or null. */
const editableEmail = z.union([z.string().email().max(100), z.string().max(0)]).nullable().optional();

/**
 * Inline-editable Lead fields (live-verified API names/types against `/settings/fields`). `.strict()`
 * so an unexpected key 400s; every field optional+nullable (null/'' clears it); `resolveWritePayload`
 * casing-resolves before the write so an unknown key can never silently no-op.
 */
// Verbatim Zoho Leads picklist values (live-verified). The Zoho field is `Status` (there is no
// `Lead_Status`). No CRM dependency exists between Status and the reason fields — the post-call
// wizard pairs them in the UI (Unqualified→Unqualified_Reason, Not Interested→Not_Interested_Reason).
export const LEAD_STATUS_VALUES = [
  'Interested',
  'Not Interested',
  'First Call',
  'Second Call',
  'Third Call',
  'Follow-up',
  'Unqualified',
  'Application Filled',
  'Email Follow-Up',
  'Unaccounted', // display "New Lead"
] as const;
export const LEAD_UNQUALIFIED_REASONS = [
  'Wrong / inactive phone number',
  'Invalid email',
  'Not in trucking industry',
  'Not using diesel',
  'Local driver',
  'Low credit score for LOC',
  'No response',
] as const;
export const LEAD_NOT_INTERESTED_REASONS = [
  'Wrong language',
  'Wrong expectations',
  'Small discounts',
  'Already has another fuel card',
  'Truck stop coverage',
  'Uncomfortable with mobile app',
  'Unreachable after application',
  'Has own fueling stations',
  'Unwilling to share personal info',
  'Low credit score / bad financials',
  "Didn't apply / applied accidentally",
  'Gas only',
  'Accidental application',
  'Low discounts',
  'Other',
] as const;

const leadEditBody = z
  .object({
    MC: z.string().max(255).nullable().optional(),
    DOT: z.union([z.number().int(), z.string().regex(/^\d{0,9}$/)]).nullable().optional(),
    Referral_Source: z.string().max(255).nullable().optional(),
    Cell: z.string().max(30).nullable().optional(),
    Phone: z.string().max(30).nullable().optional(),
    Email: editableEmail,
    Description: z.string().max(32000).nullable().optional(),
    // Post-call status wizard. Enums pin the write to real picklist values (Zoho rejects others).
    Status: z.enum(LEAD_STATUS_VALUES).nullable().optional(),
    Unqualified_Reason: z.enum(LEAD_UNQUALIFIED_REASONS).nullable().optional(),
    Not_Interested_Reason: z.enum(LEAD_NOT_INTERESTED_REASONS).nullable().optional(),
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
   * Owner→carrier matching mirrors servercrm's by-agent (id-suffix first, display-name fallback), so
   * we return the SAME carriers. The name arm needs the owner's display name: for the self case use
   * ctx.userName; for an admin targeting ANOTHER agent via ?zoho_user_id, resolve that TARGET's name
   * from the CRM directory (resolveActAsTarget) — the id arm alone misses agents whose session id
   * doesn't align with the warehouse agent_zoho_user_id.
   */
  app.get('/data-center/clients', guard, async (request) => {
    const ctx = requireSalesAccess(request);
    const q = scopeQuery.parse(request.query);
    const ownerId = resolveZohoUserId(ctx, q.zoho_user_id);
    const targetingOther = ctx.allDepartmentAccess && Boolean(q.zoho_user_id?.trim());
    // The DWH roster resolves owners id-suffix-FIRST, display-name-FALLBACK — and the session/CRM
    // id space frequently does NOT line up with dim_company.agent_zoho_user_id, so the id arm alone
    // silently returns 0 for many agents (see dwhClientRoster.ts header + the dwh-agent-name-fallback
    // note). When an admin targets another agent (this GET does not honor the x-act-as header), we
    // must supply that TARGET's name so the name-fallback arm can fire — NOT ctx.userName (the
    // admin's own name). Self path uses ctx.userName as before.
    const ownerName = targetingOther
      ? (await resolveActAsTarget(q.zoho_user_id!.trim()))?.name?.trim() || undefined
      : ctx.userName?.trim() || undefined;
    try {
      const clients = await fetchAgentClients(ownerId, ownerName);
      return { clients };
    } catch (err) {
      throw dwhError(err);
    }
  });

  /**
   * One client's fuel cards for the client modal — octane.dim_card (type/status/balance) enriched
   * with unit/driver from the latest mart transaction per card. Owner-scoped: assertCarrierOwned
   * gates a non-admin to carriers in their own book (admins / all-department bypass).
   */
  app.get('/data-center/client-cards', guard, async (request) => {
    const ctx = requireSalesAccess(request);
    const { carrierId } = carrierCardsQuery.parse(request.query);
    await assertCarrierOwned(ctx, carrierId);
    try {
      const cards = await listClientCards(carrierId);
      return { cards };
    } catch (err) {
      throw dwhError(err);
    }
  });

  /**
   * One client's billing terms (octane.dim_company: billing cycle, payment terms/day, credit limit,
   * minimum balance) for the client modal's Billing tab. Owner-scoped like /client-cards.
   */
  app.get('/data-center/client-billing', guard, async (request) => {
    const ctx = requireSalesAccess(request);
    const { carrierId } = carrierCardsQuery.parse(request.query);
    await assertCarrierOwned(ctx, carrierId);
    try {
      const billing = await getClientBilling(carrierId);
      return { billing };
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
