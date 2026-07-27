/**
 * Rejection Reports (/v1) — card declines, owned by us rather than re-read from Zoho Desk.
 *
 *  - POST /rejection-reports/webhook  — shared-secret (`x-rejection-secret`) create, called by the
 *    Zoho Desk Deluge automation immediately after `zoho.desk.create` builds the rejection ticket.
 *    Resolves the owning Sales agent from the carrier id and persists the row. Idempotent on the
 *    Desk ticket id, so a Deluge retry returns the original row instead of duplicating.
 *  - GET  /data-center/rejections     — session-authed, agent-scoped list. This REPLACES the old
 *    Zoho-backed route that lived in dataCenter.routes.ts; that one scanned a recent window of Desk
 *    tickets org-wide (lossy, `.catch(() => [])` per page, no ownership) and has been deleted. The
 *    path is unchanged so the frontend keeps working, and only ONE handler may own it — registering
 *    a second GET on the same path is `FST_ERR_DUPLICATED_ROUTE` at boot, not at request time.
 *
 * Agent scoping matches id-OR-name (see rejectionReportRepo.listForAgent): a worker's session Zoho
 * id and the warehouse's `agent_zoho_user_id` carry different org prefixes, so neither identifier
 * alone finds every row. Admins / all-department callers see the whole tenant feed.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { findCarrierOwner } from '../../integrations/dwhClientRoster.js';
import { safeEqual } from '../../lib/crypto.js';
import { AppError, AuthError } from '../../lib/errors.js';
import { audit } from '../../modules/audit/auditLogger.js';
import { systemContext } from '../../modules/auth/authService.js';
import { resolveZohoUserId } from '../../modules/tools/serverCrmScope.js';
import { rejectionReportRepo } from '../../repos/rejectionReportRepo.js';
import type { MytrionRejectionReport } from '../../db/schema/index.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { requireDepartment } from './helpers.js';

const SECRET_HEADER = 'x-rejection-secret';

/**
 * A boolean that may arrive as a real JSON boolean or as a string.
 *
 * NOT `z.coerce.boolean()`: that is just JS truthiness, so the string "false" becomes `true` — which
 * would flip `isFraud` / `isNetwork` on for every decline the moment Deluge quoted those values.
 * Deluge's `Map.toString()` normally emits unquoted booleans, but the cost of being wrong here is a
 * silently mislabelled fraud flag, so parse the string forms explicitly and reject anything else.
 */
const looseBool = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0', 'yes', 'no'])])
  .transform((v) => (typeof v === 'boolean' ? v : v === 'true' || v === '1' || v === 'yes'));

/**
 * The Deluge payload. `carrierId` and `errorCode` are REQUIRED: app.ts's JSON parser turns an empty
 * body into `{}`, so an all-optional schema would silently accept a no-op POST and store a blank
 * row. Every string is bounded.
 */
const webhookSchema = z.object({
  ticketId: z.string().max(64).optional(),
  errorCode: z.string().min(1).max(16),
  errorDescription: z.string().max(2000).optional(),
  carrierId: z.union([z.string().min(1).max(60), z.number()]),
  applicationId: z.union([z.string().max(60), z.number()]).optional(),
  companyName: z.string().max(300).optional(),
  cardNumber: z.string().max(40).optional(),
  driverName: z.string().max(200).optional(),
  driverId: z.string().max(60).optional(),
  unitNumber: z.string().max(60).optional(),
  locationName: z.string().max(300).optional(),
  locationCity: z.string().max(160).optional(),
  state: z.string().max(80).optional(),
  stationName: z.string().max(300).optional(),
  isNetwork: looseBool.optional(),
  isFraud: looseBool.optional(),
  paymentType: z.string().max(120).optional(),
  automatedResponse: z.string().max(4000).optional(),
  /** Deluge sends `yyyy-MM-dd HH:mm:ss` (no zone); anything Date can parse is accepted. */
  createdTime: z.string().max(60).optional(),
});

const listQuerySchema = z.object({
  zoho_user_id: z.string().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

/** Sales/admin gate — same gate the rest of the Data Center uses. */
function requireSalesAccess(request: FastifyRequest): TenantContext {
  return requireDepartment(request, 'sales', 'Rejection reports');
}

/** Parse the Deluge's naive `yyyy-MM-dd HH:mm:ss` (or any ISO string) into a Date, else null. */
function parseOccurredAt(raw: string | undefined): Date | null {
  if (!raw) return null;
  const d = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T') + 'Z');
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Wire shape for the Sales Data Center. The full card number is deliberately NOT sent — the UI only
 * ever shows the last 4, and there is no reason to put a PAN on the wire for a list view.
 */
function toDto(r: MytrionRejectionReport) {
  return {
    id: r.id,
    ticketId: r.zohoTicketId,
    errorCode: r.errorCode,
    errorDescription: r.errorDescription,
    carrierId: r.carrierId,
    companyName: r.companyName,
    cardLast4: r.cardLast4,
    driverName: r.driverName,
    locationName: r.locationName,
    locationCity: r.locationCity,
    locationState: r.locationState,
    stationName: r.stationName,
    isNetwork: r.isNetwork,
    isFraud: r.isFraud,
    paymentType: r.paymentType,
    automatedResponse: r.automatedResponse,
    agentName: r.agentName,
    status: r.status,
    occurredAt: (r.occurredAt ?? r.createdAt).toISOString(),
  };
}

export async function rejectionReportsRoutes(app: FastifyInstance): Promise<void> {
  const guard = { onRequest: [app.sessionOrApiKey] };

  /** Deluge → us. Shared-secret; resolves the owning agent, then persists. */
  app.post('/rejection-reports/webhook', async (request: FastifyRequest, reply: FastifyReply) => {
    const secret = env.REJECTION_WEBHOOK_SECRET;
    if (!secret) {
      throw new AppError('Rejection webhook secret is not configured', {
        statusCode: 503,
        code: 'SERVER_MISCONFIGURED',
      });
    }
    const provided = request.headers[SECRET_HEADER];
    if (typeof provided !== 'string' || !safeEqual(provided, secret)) {
      throw new AuthError('Invalid or missing rejection webhook secret');
    }

    const b = webhookSchema.parse(request.body ?? {});
    const carrierId = String(b.carrierId).trim();
    const ctx = systemContext(request.id);

    // Ownership: best-effort. A warehouse hiccup must not lose the decline — an unresolved row is
    // still recorded and shows up in the unassigned feed.
    let owner = null;
    try {
      owner = await findCarrierOwner(carrierId);
    } catch (err) {
      request.log.warn({ err, carrierId }, 'rejection webhook: carrier owner lookup failed');
    }

    const row = await rejectionReportRepo.create(ctx, {
      zohoTicketId: b.ticketId ?? null,
      errorCode: b.errorCode,
      errorDescription: b.errorDescription ?? null,
      carrierId,
      applicationId: b.applicationId != null ? String(b.applicationId) : null,
      companyName: b.companyName ?? owner?.companyName ?? null,
      cardNumber: b.cardNumber ?? null,
      driverName: b.driverName ?? null,
      driverId: b.driverId ?? null,
      unitNumber: b.unitNumber ?? null,
      locationName: b.locationName ?? null,
      locationCity: b.locationCity ?? null,
      locationState: b.state ?? null,
      stationName: b.stationName ?? null,
      isNetwork: b.isNetwork ?? false,
      isFraud: b.isFraud ?? false,
      paymentType: b.paymentType ?? null,
      automatedResponse: b.automatedResponse ?? null,
      agentZohoUserId: owner?.agentZohoUserId ?? null,
      agentName: owner?.agentName ?? null,
      ownerSource: owner ? owner.source : 'unresolved',
      occurredAt: parseOccurredAt(b.createdTime),
    });

    // Secret-authed webhook (no session ctx) → synthetic system actor. The card number is never
    // included in audit detail; the last 4 is enough to trace a row back to a decline.
    await audit({
      tenantId: ctx.tenantId,
      action: 'rejection.report.webhook',
      status: 'ok',
      audience: 'internal',
      userName: 'rejection-webhook',
      resourceType: 'rejection_report',
      resourceId: row.id,
      detail: {
        carrierId,
        errorCode: row.errorCode,
        ticketId: row.zohoTicketId,
        cardLast4: row.cardLast4,
        ownerSource: row.ownerSource,
        agentZohoUserId: row.agentZohoUserId,
      },
      requestId: request.id,
    });

    return reply.code(201).send({ id: row.id, ownerSource: row.ownerSource });
  });

  /**
   * The agent's rejection reports (replaces the Zoho Desk scan). Admin / all-department callers see
   * the whole tenant feed; everyone else sees the carriers they own, matched id-or-name.
   */
  app.get('/data-center/rejections', guard, async (request) => {
    const ctx = requireSalesAccess(request);
    const q = listQuerySchema.parse(request.query);
    const page = {
      ...(q.limit !== undefined ? { limit: q.limit } : {}),
      ...(q.offset !== undefined ? { offset: q.offset } : {}),
    };

    // Admin with no explicit target → the full feed. With ?zoho_user_id they act as that agent.
    if (ctx.allDepartmentAccess && !q.zoho_user_id) {
      const all = await rejectionReportRepo.listAll(ctx, page);
      return { rejections: all.map(toDto) };
    }

    const agentZohoUserId = resolveZohoUserId(ctx, q.zoho_user_id);
    const rows = await rejectionReportRepo.listForAgent(ctx, {
      agentZohoUserId,
      // The name arm only applies to the caller's OWN feed — when acting as someone else we have
      // their id but not their name, and matching on the admin's name would leak the wrong rows.
      agentName: q.zoho_user_id ? null : (ctx.userName ?? null),
      ...page,
    });
    return { rejections: rows.map(toDto) };
  });
}
