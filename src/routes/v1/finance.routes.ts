/**
 * Finance Mytrion backend (/v1/finance/*). Every route is `finance`-department gated: admins /
 * all-department / bypass pass, otherwise the caller needs `finance`. The Mytrion→department map is
 * `finance` → `finance` (src/lib/mytrions.ts), and the endpoint is the real security boundary
 * regardless of any per-tab gating in the UI.
 *
 * Read-only. Nothing here moves money — Finance's write surface (EFS top-up / sweep, money codes)
 * is deliberately still "coming soon" in the UI rather than half-wired here.
 *
 * The EFS parent balance the Home tab shows is NOT here: it comes from the existing
 * `finance.parent_snapshot` Deluge touchpoint (POST /v1/touchpoints/finance.parent_snapshot), which
 * is already finance-gated by the touchpoint catalog.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { listDwhTransactions } from '../../integrations/dwhTransactions.js';
import { AppError, errorMessage } from '../../lib/errors.js';
import { fetchCarrierInvoices, fetchCarrierPayments } from '../../modules/finance/financeCarrier.js';
import {
  fetchFinanceClientDetail,
  fetchFinanceClients,
} from '../../modules/finance/financeClients.js';
import { NotFoundError } from '../../lib/errors.js';
import { requireDepartment } from './helpers.js';
import type { TenantContext } from '../../types/tenantContext.js';

/** Finance access gate — internal audience + admin/all-dept/bypass/`finance` department. */
function requireFinanceAccess(request: FastifyRequest): TenantContext {
  return requireDepartment(request, 'finance', 'Finance');
}

/** Carrier ids are digits in both the CMP and DWH domains — reject anything else before it binds. */
const carrierParam = z.object({ carrierId: z.string().regex(/^\d{1,20}$/, 'carrierId must be numeric') });
const limitQuery = z.object({ limit: z.coerce.number().int().min(1).max(1000).optional() });

/** Wrap any warehouse failure as a clean, retryable 502 rather than a 500 stack. */
function dwhError(err: unknown): AppError {
  return new AppError(`Finance warehouse read failed: ${errorMessage(err)}`, {
    statusCode: 502,
    code: 'DWH_ERROR',
    expose: true,
    cause: err,
  });
}

export async function financeRoutes(app: FastifyInstance): Promise<void> {
  const guard = { onRequest: [app.sessionOrApiKey] };

  // Clients tab — every carrier with payment terms, credit and computed debt. dim_company +
  // cmp_invoice only (no mart scan), so this stays fast enough to filter client-side.
  app.get('/finance/clients', guard, async (request) => {
    requireFinanceAccess(request);
    try {
      const clients = await fetchFinanceClients();
      return { clients, total: clients.length, fetchedAt: new Date().toISOString() };
    } catch (err) {
      throw dwhError(err);
    }
  });

  // Modal → Details. The rest of the carrier's profile, kept off the roster payload so the list
  // stays small; debt is recomputed here with the same predicate so the two can never disagree.
  app.get('/finance/clients/:carrierId', guard, async (request) => {
    requireFinanceAccess(request);
    const { carrierId } = carrierParam.parse(request.params);
    let detail;
    try {
      detail = await fetchFinanceClientDetail(carrierId);
    } catch (err) {
      throw dwhError(err);
    }
    if (!detail) throw new NotFoundError(`Carrier ${carrierId} not found`);
    return detail;
  });

  // Modal → Invoices. Same cmp_invoice table the roster's debt figure is computed from.
  app.get('/finance/clients/:carrierId/invoices', guard, async (request) => {
    requireFinanceAccess(request);
    const { carrierId } = carrierParam.parse(request.params);
    const { limit } = limitQuery.parse(request.query);
    try {
      return await fetchCarrierInvoices(carrierId, limit);
    } catch (err) {
      throw dwhError(err);
    }
  });

  // Modal → Payments. Our own payment_transactions ledger, matched on carrier_id.
  app.get('/finance/clients/:carrierId/payments', guard, async (request) => {
    requireFinanceAccess(request);
    const { carrierId } = carrierParam.parse(request.params);
    const { limit } = limitQuery.parse(request.query);
    return fetchCarrierPayments(carrierId, limit);
  });

  // Modal → Transactions. The shared mart reader, so these rows match every other surface's.
  app.get('/finance/clients/:carrierId/transactions', guard, async (request) => {
    requireFinanceAccess(request);
    const { carrierId } = carrierParam.parse(request.params);
    const q = z
      .object({ range: z.string().optional(), from: z.string().optional(), to: z.string().optional() })
      .merge(limitQuery)
      .parse(request.query);
    try {
      return await listDwhTransactions({
        carrierId,
        range: q.range ?? 'month',
        from: q.from,
        to: q.to,
        limit: q.limit ?? 200,
      });
    } catch (err) {
      throw dwhError(err);
    }
  });
}
