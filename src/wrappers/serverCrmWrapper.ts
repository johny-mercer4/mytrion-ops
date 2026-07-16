/**
 * Named, typed façade over servercrm's HTTP endpoints (src/integrations/serverCrm.ts) — one method
 * per carrier-facing capability instead of raw path strings scattered across callers. Mirrors
 * servercrm's own internal split (agentDwh.js's per-capability functions on top of one client).
 */
import { crmGet } from './serverCrmClient.js';

export interface TransactionsRangeOpts {
  range?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
}

export interface InvoicesRangeOpts {
  range?: string | undefined;
  status?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
}

export const serverCrmWrapper = {
  /** Real-time carrier limit + EFS balance (servercrm calls live EFS internally). */
  getCarrierBalance(carrierId: string) {
    return crmGet(`/api/agent/dwh/carrier-balance/${encodeURIComponent(carrierId)}`);
  },

  /** Account standing + debt — combines DWH context, live EFS balance, and CMP invoice debt. */
  getCarrierOverview(carrierId: string) {
    return crmGet(`/api/agent/dwh/carrier-overview/${encodeURIComponent(carrierId)}`);
  },

  /** The carrier's fuel cards (DWH mart). */
  getCards(carrierId: string) {
    return crmGet(`/api/agent/dwh/cards/${encodeURIComponent(carrierId)}`);
  },

  /** Per-card last-used date (DWH mart). */
  getLastUsed(carrierId: string, range?: string) {
    return crmGet(`/api/agent/dwh/cards/${encodeURIComponent(carrierId)}/last-used`, {
      range: range ?? 'all_time',
    });
  },

  /** Fuel transaction line items (DWH mart). `range` follows servercrm's vocabulary
   * (day/week/month/quarter/half_year/year/all_time), overridden to 'custom' when from+to are set. */
  getTransactions(carrierId: string, opts: TransactionsRangeOpts = {}) {
    return crmGet(`/api/agent/dwh/transactions/${encodeURIComponent(carrierId)}`, {
      range: opts.from && opts.to ? 'custom' : (opts.range ?? 'month'),
      ...(opts.from ? { from: opts.from } : {}),
      ...(opts.to ? { to: opts.to } : {}),
      limit: 100,
    });
  },

  /** Billing-cycle + invoice/payment totals over a trailing window (default 90 days). */
  getPaymentInfo(carrierId: string) {
    return crmGet(`/api/agent/dwh/payment-info/${encodeURIComponent(carrierId)}`, { days: 90 });
  },

  /** Invoice list (DWH's `public.cmp_invoice` replica). `carrierId` is a query param here, not a path segment. */
  getInvoices(carrierId: string, opts: InvoicesRangeOpts = {}) {
    return crmGet<{ data?: Array<Record<string, unknown>> }>('/api/salesMytrion/fetchInvoices', {
      carrierId,
      range: opts.from && opts.to ? 'custom' : (opts.range ?? 'last_30'),
      ...(opts.status ? { status: opts.status } : {}),
      ...(opts.from ? { from: opts.from } : {}),
      ...(opts.to ? { to: opts.to } : {}),
    });
  },

  /** A time-limited signed URL for one invoice's PDF. Not itself carrier-scoped upstream — callers
   * must verify ownership (e.g. via getInvoices) before minting one. */
  getInvoiceSignedUrl(invoiceId: string) {
    return crmGet(`/api/salesMytrion/invoices/${encodeURIComponent(invoiceId)}/signed-url`, { type: 'pdf' });
  },
};
