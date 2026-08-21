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
import { loyaltyOverrides } from '../../modules/manager/loyaltyOverrides.js';
import { listClientCards, getClientBilling } from '../../integrations/dwhCards.js';
import { zohoCrmRecords } from '../../integrations/zohoCrmRecords.js';
import { updateRecordAsUser, zohoActorId } from '../../integrations/zohoUserAuth.js';
import { fetchRecordCallHistory, type CrmModule } from '../../modules/sales/recordActivity.js';
import {
  enrichLeadBlueprintTransitions,
  executeLeadBlueprintTransition,
} from '../../modules/sales/leadBlueprint.js';
import { applyLeadUpdateWithStatus } from '../../modules/sales/leadStatusUpdate.js';
import {
  LEAD_NOT_INTERESTED_REASONS,
  LEAD_STATUS_VALUES,
  LEAD_UNQUALIFIED_REASONS,
} from '../../modules/sales/leadStatusValues.js';

export {
  LEAD_NOT_INTERESTED_REASONS,
  LEAD_STATUS_VALUES,
  LEAD_UNQUALIFIED_REASONS,
} from '../../modules/sales/leadStatusValues.js';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import { resolveActAsTarget } from '../../modules/auth/actAsDirectory.js';
import { assertCarrierOwned, resolveZohoUserId } from '../../modules/tools/serverCrmScope.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { registerDataCenterNoteRoutes } from './dataCenterNotes.routes.js';
import { requireDepartment } from './helpers.js';

/** Sales/admin gate (internal audience only, session-authoritative departments). */
function requireSalesAccess(request: FastifyRequest): TenantContext {
  return requireDepartment(request, 'sales', 'Data Center');
}

const scopeQuery = z.object({ zoho_user_id: z.string().max(120).optional() });
const carrierCardsQuery = z.object({
  carrierId: z.string().regex(/^\d+$/, 'carrierId must be numeric').max(20),
});
const idParam = z.object({ id: z.string().regex(/^\d+$/, 'id must be a CRM record id').max(60) });
const blueprintTransitionParam = idParam.extend({
  transitionId: z.string().regex(/^\d+$/, 'transitionId must be a CRM transition id').max(60),
});
const blueprintTransitionBody = z
  .object({
    data: z.record(z.union([z.string().max(32000), z.number(), z.boolean(), z.null()])).default({}),
  })
  .strict();

/** An email that may be a valid address, an empty string (clears the field), or null. */
const editableEmail = z
  .union([z.string().email().max(100), z.string().max(0)])
  .nullable()
  .optional();

/**
 * Inline-editable Lead fields (live-verified API names/types against `/settings/fields`). `.strict()`
 * so an unexpected key 400s; every field optional+nullable (null/'' clears it); `resolveWritePayload`
 * casing-resolves before the write so an unknown key can never silently no-op.
 */
// Status + reason enums: `leadStatusValues.ts`. The Zoho field is `Status` (no `Lead_Status`).
const leadEditBody = z
  .object({
    MC: z.string().max(255).nullable().optional(),
    DOT: z
      .union([z.number().int(), z.string().regex(/^\d{0,9}$/)])
      .nullable()
      .optional(),
    Referral_Source: z.string().max(255).nullable().optional(),
    Cell: z.string().max(30).nullable().optional(),
    Phone: z.string().max(30).nullable().optional(),
    Email: editableEmail,
    Description: z.string().max(32000).nullable().optional(),
    // Post-call status wizard. Enums pin the write to real picklist values (Zoho rejects others).
    Status: z.enum(LEAD_STATUS_VALUES).nullable().optional(),
    Unqualified_Reason: z.enum(LEAD_UNQUALIFIED_REASONS).nullable().optional(),
    Not_Interested_Reason: z.enum(LEAD_NOT_INTERESTED_REASONS).nullable().optional(),
    // Blueprint "Application Filled" required field — rides with Status as transition data.
    Application_ID: z
      .union([z.number(), z.string().max(40)])
      .nullable()
      .optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'no editable fields supplied')
  .superRefine((v, ctx) => {
    if (v.Status === 'Unqualified' && !v.Unqualified_Reason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Unqualified Reason is required',
        path: ['Unqualified_Reason'],
      });
    }
    if (v.Status === 'Not Interested' && !v.Not_Interested_Reason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Not Interested Reason is required',
        path: ['Not_Interested_Reason'],
      });
    }
    if (
      v.Status === 'Application Filled' &&
      (v.Application_ID === undefined || v.Application_ID === null || v.Application_ID === '')
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Application ID is required',
        path: ['Application_ID'],
      });
    }
  });

/** Inline-editable Deal fields (Description = the "Notes" textarea; deal value is intentionally not editable). */
const dealEditBody = z
  .object({
    Email: editableEmail,
    Phone: z.string().max(30).nullable().optional(),
    Cell: z.string().max(30).nullable().optional(),
    Secondary_Email: editableEmail,
    Description: z.string().max(32000).nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'no editable fields supplied');

function crmError(err: unknown): AppError {
  if (err instanceof AppError) return err;
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
      const [clients, overrides] = await Promise.all([
        fetchAgentClients(ownerId, ownerName),
        loyaltyOverrides(ctx),
      ]);
      return {
        clients: clients.map((client) => ({
          ...client,
          loyaltyOverride: overrides.get(client.carrierId) ?? null,
        })),
      };
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

  // GET /data-center/rejections now lives in rejectionReports.routes.ts, served from our own
  // mytrion_rejection_reports table (written by the Zoho Deluge webhook) instead of scanning a
  // recent window of Desk tickets org-wide. It must be declared in exactly ONE place — a second GET
  // on this path is FST_ERR_DUPLICATED_ROUTE at boot.

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
        throw new AppError('Record not found', {
          statusCode: 404,
          code: 'NOT_FOUND',
          expose: true,
        });
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
      throw new AppError('No editable fields supplied', {
        statusCode: 400,
        code: 'NO_FIELDS',
        expose: true,
      });
    }
    // leadEditBody / dealEditBody are .strict() schemas whose keys ARE the exact Zoho API field
    // names — no casing ambiguity. resolveWritePayload is designed for CS/billing routes where
    // field names are user-supplied; here it can reject valid system fields (e.g. Description on
    // Leads) that Zoho omits from its /settings/fields metadata response.
    const resolved = payload;

    // Lead `Status` is Blueprint-controlled: a plain updateRecord is rejected while the lead is in an
    // active blueprint (and would drop the other edits with it). Split it out — see the helper.
    let updatedFields: string[];
    if (module === 'Leads' && 'Status' in resolved) {
      updatedFields = await applyLeadUpdateWithStatus(ctx, id, resolved);
    } else {
      try {
        await updateRecordAsUser(ctx.tenantId, zohoActorId(ctx), module, id, resolved);
      } catch (err) {
        throw crmError(err);
      }
      updatedFields = Object.keys(resolved);
    }
    await auditFromContext(ctx, {
      action: module === 'Leads' ? 'sales.datacenter.lead_update' : 'sales.datacenter.deal_update',
      status: 'ok',
      resourceType: module === 'Leads' ? 'crm_lead' : 'crm_deal',
      resourceId: id,
      detail: { fields: updatedFields },
    });
    return { id, updatedFields };
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

  // ---- Per-record call history + Notes (sales gate → record-ownership check → Zoho) ----

  /** Sales gate + record-ownership check for a read/log under one record; returns the scoped ctx+id. */
  async function assertOwnedRecord(
    request: FastifyRequest,
    module: CrmModule,
    fetchOwner: (id: string) => Promise<string | null>,
  ): Promise<{ ctx: TenantContext; id: string }> {
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
        throw new AppError('Record not found', {
          statusCode: 404,
          code: 'NOT_FOUND',
          expose: true,
        });
      }
      if (recordOwner !== targetOwner) {
        throw new RBACError('You can only view your own records');
      }
    }
    return { ctx, id };
  }

  app.get('/data-center/leads/:id/blueprint', guard, async (request) => {
    const { id } = await assertOwnedRecord(request, 'Leads', fetchLeadOwnerId);
    try {
      const blueprint = await zohoCrmRecords.getBlueprintDetails('Leads', id);
      if (!blueprint) return { blueprint: null };
      return {
        blueprint: {
          ...blueprint,
          transitions: enrichLeadBlueprintTransitions(blueprint.transitions),
        },
      };
    } catch (err) {
      throw crmError(err);
    }
  });

  app.post('/data-center/leads/:id/blueprint/:transitionId', guard, async (request) => {
    const { ctx, id } = await assertOwnedRecord(request, 'Leads', fetchLeadOwnerId);
    const { transitionId } = blueprintTransitionParam.parse(request.params);
    const { data } = blueprintTransitionBody.parse(request.body);
    try {
      const result = await executeLeadBlueprintTransition(ctx, id, transitionId, data);
      await auditFromContext(ctx, {
        action: 'sales.datacenter.lead_blueprint_transition',
        status: 'ok',
        resourceType: 'crm_lead',
        resourceId: id,
        detail: { transitionId, from: result.currentValue, to: result.nextValue },
      });
      return { id, transitionId, status: result.nextValue };
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw crmError(err);
    }
  });

  /** Merged call history (our mytrion_calls + the Zoho Calls related to the record), badged by source. */
  app.get('/data-center/leads/:id/calls', guard, async (request) => {
    const { ctx, id } = await assertOwnedRecord(request, 'Leads', fetchLeadOwnerId);
    return { calls: await fetchRecordCallHistory(ctx, 'Leads', id) };
  });
  app.get('/data-center/deals/:id/calls', guard, async (request) => {
    const { ctx, id } = await assertOwnedRecord(request, 'Deals', fetchDealOwnerId);
    return { calls: await fetchRecordCallHistory(ctx, 'Deals', id) };
  });

  await registerDataCenterNoteRoutes(app, assertOwnedRecord);
}
