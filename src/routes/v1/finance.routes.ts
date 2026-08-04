/**
 * Finance Mytrion backend (/v1/finance/*). Every route is `finance`-department gated: admins /
 * all-department / bypass pass, otherwise the caller needs `finance`. The Mytrion→department map is
 * `finance` → `finance` (src/lib/mytrions.ts), and the endpoint is the real security boundary
 * regardless of any per-tab gating in the UI.
 *
 * Read-only. Nothing here moves money: the EFS and money-code routes below READ live vendor state
 * (balances, past top-ups/sweeps, issued codes). Initiating a load or issuing/voiding a code stays
 * out of this file — those need servercrm's `EFS_TOUCHPOINTS_WRITES_ENABLED` gate plus an audited,
 * role-gated endpoint of our own, and a half-wired money-moving button is worse than none.
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
import {
  EFS_MAX_WINDOW_DAYS,
  fetchCarrierMoneyCodes,
  fetchEfsLoads,
  fetchEfsSnapshot,
  fetchMoneyCodeDetail,
  MONEY_CODE_STATUSES,
} from '../../modules/finance/financeEfs.js';
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

/**
 * The EFS window: either a rolling `days` count or an explicit `from`/`to` pair of calendar dates.
 *
 * EFS caps history at 90 days either way, and the span check for a custom range lives in
 * `efsWindow` (which throws a 400) so the rule is stated once rather than duplicated per route.
 * `.strict()` matters here: a typo'd `start=`/`end=` must 400 rather than be silently dropped and
 * answered with the default 30-day window — the same "never silently ignore a filter" rule the
 * `finance.main_transactions` touchpoint learned the hard way.
 */
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected yyyy-mm-dd');
const windowQuery = z
  .object({
    days: z.coerce.number().int().min(1).max(EFS_MAX_WINDOW_DAYS).optional(),
    from: ymd.optional(),
    to: ymd.optional(),
  })
  .strict()
  .refine((q) => (q.from === undefined) === (q.to === undefined), {
    message: 'from and to must be given together',
  });
const moneyCodeQuery = windowQuery.innerType()
  .extend({ status: z.enum(MONEY_CODE_STATUSES).optional() })
  .strict()
  .refine((q) => (q.from === undefined) === (q.to === undefined), {
    message: 'from and to must be given together',
  });

/** Turn the parsed query into the reader's window argument — dates win over a rolling count. */
function windowArg(q: {
  days?: number | undefined;
  from?: string | undefined;
  to?: string | undefined;
}): number | { from: string; to: string } | undefined {
  if (q.from !== undefined && q.to !== undefined) return { from: q.from, to: q.to };
  return q.days;
}
/** EFS code ids are numeric; the same pre-bind guard the carrier param gets. */
const codeParam = z.object({ codeId: z.string().regex(/^\d{1,20}$/, 'codeId must be numeric') });

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

  // Modal → EFS. Live contract balances and the cards drawing on them. Split from the loads read
  // below so the balance renders while the (slower) movement history is still in flight.
  // The finance readers already map upstream failures to 502/400 — no dwhError wrap here.
  app.get('/finance/clients/:carrierId/efs', guard, async (request) => {
    requireFinanceAccess(request);
    const { carrierId } = carrierParam.parse(request.params);
    return fetchEfsSnapshot(carrierId);
  });

  // Modal → EFS. Top-ups and sweeps in a bounded window: `?days=30` or `?from=&to=`.
  app.get('/finance/clients/:carrierId/efs/loads', guard, async (request) => {
    requireFinanceAccess(request);
    const { carrierId } = carrierParam.parse(request.params);
    const q = windowQuery.parse(request.query);
    return fetchEfsLoads(carrierId, windowArg(q));
  });

  // Modal → Money Codes. Codes come back with the redeemable digits already stripped by
  // financeEfs.toMoneyCode — see that module's header before changing this response.
  app.get('/finance/clients/:carrierId/money-codes', guard, async (request) => {
    requireFinanceAccess(request);
    const { carrierId } = carrierParam.parse(request.params);
    const q = moneyCodeQuery.parse(request.query);
    return fetchCarrierMoneyCodes(carrierId, windowArg(q), q.status ?? 'ALL');
  });

  // Modal → Money Codes → one code's redemptions. Keyed by EFS `codeId`, never by the code itself:
  // `getMoneyCode(serial)` crashes EFS, and the UI does not hold the digits to pass anyway.
  app.get('/finance/money-codes/:codeId', guard, async (request) => {
    requireFinanceAccess(request);
    const { codeId } = codeParam.parse(request.params);
    return fetchMoneyCodeDetail(codeId);
  });
}
