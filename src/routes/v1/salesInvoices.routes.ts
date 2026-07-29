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
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { serverCrmAuthHeaders, serverCrmBaseUrl } from '../../integrations/serverCrm.js';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
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

const CONTENT_TYPE: Record<'pdf' | 'excel', string> = {
  pdf: 'application/pdf',
  excel: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

/** 60s: a detailed CMP invoice export is slow, but a hung fetch must not pin a connection open. */
const FETCH_TIMEOUT_MS = 60_000;

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
        detail: { type, upstreamStatus: upstream.status },
      });
      // 4xx is the caller's problem (bad/unknown invoice); anything else is ours.
      throw new AppError(message, {
        code: 'UPSTREAM_ERROR',
        statusCode: upstream.status >= 400 && upstream.status < 500 ? upstream.status : 502,
        expose: true,
      });
    }

    const buffer = Buffer.from(await upstream.arrayBuffer());
    await auditFromContext(ctx, {
      action: 'sales.invoice.download',
      status: 'ok',
      resourceType: 'cmp_invoice',
      resourceId: invoiceId,
      detail: { type, bytes: buffer.length },
    });

    return await reply
      .header('Content-Type', upstream.headers.get('content-type') ?? CONTENT_TYPE[type])
      .header('Content-Length', buffer.length)
      .header('Content-Disposition', 'attachment')
      .send(buffer);
  });
}
