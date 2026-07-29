/**
 * Sales invoice downloads (/v1/sales/invoices) — same-origin binary proxy for the Automations
 * "Request Invoices" (C-20 / Q-1) action.
 *
 * Why a proxy and not a redirect: servercrm exposes the invoice bytes at
 * `/api/salesMytrion/invoices/:id/{pdf,excel}` behind the static `x-api-key`, and the browser can
 * neither hold that key nor read a cross-origin response. The self-service widget's desktop path
 * (automation-modal.js `_downloadInvoicePdf`) does `fetch(...) -> resp.blob() -> anchor`, which is
 * what actually produces a file; the signed-URL + navigate variant next to it is the MOBILE-only
 * branch (blob URLs don't survive the Zoho app WebView tab hop). Mytrion had adopted the mobile
 * branch for every platform, so a desktop click resolved without ever downloading anything
 * (QA round 3). Serving the bytes from our own origin restores the reference behaviour and keeps
 * the servercrm key server-side.
 *
 * AUTHORIZATION. servercrm's invoice routes are keyed by invoice id alone — no carrier scope — so
 * a bare `:invoiceId` endpoint would let any sales user enumerate every carrier's invoices. Both
 * routes here therefore require `carrierId` and run two independent checks:
 *   1. `assertCarrierOwned` — the caller's own client list must contain that carrier;
 *   2. the invoice must actually appear in that carrier's invoice set.
 * Step 2 is what makes step 1 meaningful: without it the caller could name a carrier they DO own
 * and then pass someone else's invoice id.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError, RBACError } from '../../lib/errors.js';
import { serverCrm, serverCrmAuthHeaders, serverCrmBaseUrl } from '../../integrations/serverCrm.js';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import { assertCarrierOwned } from '../../modules/tools/serverCrmScope.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { requireDepartment } from './helpers.js';

/** Sales/admin gate (internal audience only, session-authoritative departments). */
function requireSalesAccess(request: FastifyRequest): TenantContext {
  return requireDepartment(request, 'sales', 'Invoice downloads');
}

const paramsSchema = z.object({
  /** servercrm rejects anything non-numeric; mirror that here so a bad id never leaves our process. */
  invoiceId: z.string().regex(/^\d+$/, 'invoiceId must be a positive integer'),
  type: z.enum(['pdf', 'excel']),
});

/** Required — see the AUTHORIZATION note above. */
const querySchema = z.object({
  carrierId: z.string().regex(/^\d+$/, 'carrierId is required and must be a positive integer'),
});

const CONTENT_TYPE: Record<'pdf' | 'excel', string> = {
  pdf: 'application/pdf',
  excel: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

/** 60s: a detailed CMP invoice export is slow, but a hung fetch must not pin a connection open. */
const FETCH_TIMEOUT_MS = 60_000;
/** servercrm caps `limit` at 5000; page at the ceiling to minimize round trips. */
const MEMBERSHIP_LIMIT = 5000;
/** Defensive ceiling against a broken upstream returning `more_records: true` forever. */
const MEMBERSHIP_MAX_PAGES = 100;

interface InvoiceListResponse {
  data?: Array<Record<string, unknown>>;
  more_records?: boolean;
}

/** Every id spelling servercrm has used for an invoice row, so the check can't be fooled by drift. */
function invoiceIdsOf(rows: Array<Record<string, unknown>>): Set<string> {
  const ids = new Set<string>();
  for (const row of rows) {
    for (const key of ['invoiceId', 'invoice_id', 'id']) {
      const v = row[key];
      if (v != null && String(v).trim()) ids.add(String(v).trim());
    }
  }
  return ids;
}

/**
 * Both halves of the authorization check. Throws RBACError when the caller doesn't own the carrier
 * or the invoice isn't part of it. Fails CLOSED: an unverifiable answer is a denial, never a pass.
 */
async function assertInvoiceOwned(
  request: FastifyRequest,
  ctx: TenantContext,
  carrierId: string,
  invoiceId: string,
): Promise<void> {
  await assertCarrierOwned(ctx, carrierId);

  try {
    for (let page = 1; page <= MEMBERSHIP_MAX_PAGES; page++) {
      const list = await serverCrm.get<InvoiceListResponse>('/api/salesMytrion/fetchInvoices', {
        carrierId,
        range: 'all_time',
        page,
        limit: MEMBERSHIP_LIMIT,
      });
      const rows = Array.isArray(list?.data) ? list.data : [];
      if (invoiceIdsOf(rows).has(invoiceId)) return;
      if (list?.more_records !== true) break;
      if (page === MEMBERSHIP_MAX_PAGES) {
        request.log.warn(
          { carrierId, invoiceId, pages: MEMBERSHIP_MAX_PAGES },
          'invoice membership lookup exceeded its defensive page ceiling',
        );
      }
    }
  } catch (err) {
    throw new AppError('Could not verify this invoice — try again.', {
      statusCode: 502,
      code: 'UPSTREAM_ERROR',
      expose: true,
      cause: err,
    });
  }
  throw new RBACError('That invoice does not belong to this carrier.');
}

export async function salesInvoicesRoutes(app: FastifyInstance): Promise<void> {
  const guard = { preHandler: app.authenticate };

  /**
   * Stream one invoice export as an attachment. `?download=1` upstream forces
   * `Content-Disposition: attachment` on the CMP side; we set our own regardless so the
   * browser never renders the bytes inline in place of the app.
   */
  app.get('/sales/invoices/:invoiceId/:type', guard, async (request, reply) => {
    const ctx = requireSalesAccess(request);
    const { invoiceId, type } = paramsSchema.parse(request.params);
    const { carrierId } = querySchema.parse(request.query);
    await assertInvoiceOwned(request, ctx, carrierId, invoiceId);

    const url = `${serverCrmBaseUrl()}/api/salesMytrion/invoices/${encodeURIComponent(invoiceId)}/${type}?download=1`;

    let upstream: Response;
    try {
      // Only the API key travels upstream — Content-Type from serverCrmAuthHeaders would be a
      // lie on a GET that returns binary.
      const { 'x-api-key': apiKey } = serverCrmAuthHeaders();
      upstream = await fetch(url, {
        headers: { 'x-api-key': apiKey ?? '' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch (err) {
      request.log.error({ err, invoiceId, type }, 'invoice export fetch failed');
      throw new AppError('The invoice service is unreachable — try again.', {
        code: 'UPSTREAM_ERROR',
        statusCode: 502,
        cause: err,
      });
    }

    if (!upstream.ok) {
      // servercrm answers errors as JSON even on the binary routes; surface its message when it
      // has one so "invoice not found" doesn't read as a generic failure.
      const body = await upstream.text().catch(() => '');
      let message = `Invoice service returned ${upstream.status}.`;
      try {
        const parsed = JSON.parse(body) as { message?: unknown };
        if (typeof parsed.message === 'string' && parsed.message.trim()) message = parsed.message;
      } catch {
        /* non-JSON body — keep the status-based message */
      }
      await auditFromContext(ctx, {
        action: 'sales.invoice.download',
        status: 'error',
        resourceType: 'cmp_invoice',
        resourceId: invoiceId,
        detail: { type, carrierId, upstreamStatus: upstream.status },
      });
      // Only validation/not-found/conflict errors belong to the caller. An upstream 401/403 means
      // our server credential is broken and must not trigger the browser's bearer-refresh path.
      const passthrough = [400, 404, 409, 422].includes(upstream.status);
      throw new AppError(message, {
        code: 'UPSTREAM_ERROR',
        statusCode: passthrough ? upstream.status : 502,
        expose: true,
      });
    }

    const buffer = Buffer.from(await upstream.arrayBuffer());
    await auditFromContext(ctx, {
      action: 'sales.invoice.download',
      status: 'ok',
      resourceType: 'cmp_invoice',
      resourceId: invoiceId,
      detail: { type, carrierId, bytes: buffer.length },
    });

    return await reply
      .header('Content-Type', upstream.headers.get('content-type') ?? CONTENT_TYPE[type])
      .header('Content-Length', buffer.length)
      .header('Content-Disposition', 'attachment')
      .send(buffer);
  });

  /**
   * Short-lived signed URL for the Zoho app WebView, where a blob URL cannot survive the tab hop.
   * Same two-part ownership check as the binary route — the raw servercrm endpoint mints a token
   * for ANY invoice id, so this must never be reachable without it.
   */
  app.get('/sales/invoices/:invoiceId/:type/signed-url', guard, async (request) => {
    const ctx = requireSalesAccess(request);
    const { invoiceId, type } = paramsSchema.parse(request.params);
    const { carrierId } = querySchema.parse(request.query);
    await assertInvoiceOwned(request, ctx, carrierId, invoiceId);

    let signed: { url?: string; expiresIn?: number };
    try {
      signed = await serverCrm.get<{ url?: string; expiresIn?: number }>(
        `/api/salesMytrion/invoices/${encodeURIComponent(invoiceId)}/signed-url`,
        { type },
      );
    } catch (err) {
      throw new AppError('Could not generate a download link — try again.', {
        statusCode: 502,
        code: 'UPSTREAM_ERROR',
        expose: true,
        cause: err,
      });
    }
    if (!signed?.url) {
      throw new AppError(`No ${type.toUpperCase()} available for this invoice.`, {
        statusCode: 404,
        code: 'NOT_FOUND',
        expose: true,
      });
    }

    await auditFromContext(ctx, {
      action: 'sales.invoice.signed_url',
      status: 'ok',
      resourceType: 'cmp_invoice',
      resourceId: invoiceId,
      detail: { type, carrierId },
    });
    return { url: signed.url, expiresIn: signed.expiresIn ?? 120 };
  });
}
