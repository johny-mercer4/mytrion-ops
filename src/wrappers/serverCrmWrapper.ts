/**
 * Named, typed façade over servercrm's HTTP endpoints (src/integrations/serverCrm.ts) — one method
 * per carrier-facing capability instead of raw path strings scattered across callers. Mirrors
 * servercrm's own internal split (agentDwh.js's per-capability functions on top of one client).
 */
import { crmGet, crmPost } from './serverCrmClient.js';

export interface TransactionsRangeOpts {
  range?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  /** Rows per page. servercrm defaults to 500 and caps at 5000. Driver-scoped reads raise this so
   *  the caller's own-card filter sees the whole window rather than page 1 of the fleet's rows. */
  limit?: number | undefined;
}

export interface InvoicesRangeOpts {
  range?: string | undefined;
  status?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
}

/** A `{ count, data[] }` row list from the DWH marts (cards, last-used). servercrm selects whole
 *  mart rows, so the columns stay open-ended — `card_number` is the only one callers rely on. */
export interface CarrierRowList {
  count?: number;
  data?: Array<Record<string, unknown>>;
  [k: string]: unknown;
}

/** Invoice list + the summary servercrm accumulates over the whole window: `total_invoices`,
 *  `paid_count`, `open_count`, `cancelled_count`, `sum_total_amount`, `sum_total_paid` and
 *  `sum_open_balance` (the last filtered to PENDING/PARTIALLY_PAID — i.e. what is actually owed). */
export interface CarrierInvoices {
  count?: number;
  summary?: Record<string, unknown>;
  data?: Array<Record<string, unknown>>;
  [k: string]: unknown;
}

/** Transaction line items + the accumulated totals servercrm computes over the whole filter set. */
export interface CarrierTransactions {
  totals?: Record<string, unknown>;
  data?: Array<Record<string, unknown>>;
  pagination?: Record<string, unknown>;
  [k: string]: unknown;
}

/** carrier-balance payload (servercrm agentDwh.getCarrierBalance). `efs_balance` is the carrier's
 *  live available funds for BOTH account types — LOC: room on the line; prepay: prepaid balance —
 *  and is null (with `efs_error` set) when EFS is unreachable. */
export interface CarrierBalance {
  is_active?: boolean;
  account_type?: string | null;
  efs_balance?: number | null;
  efs_error?: string | null;
  [k: string]: unknown;
}

export const serverCrmWrapper = {
  /** Real-time carrier limit + EFS balance (servercrm calls live EFS internally). */
  getCarrierBalance(carrierId: string) {
    return crmGet<CarrierBalance>(`/api/agent/dwh/carrier-balance/${encodeURIComponent(carrierId)}`);
  },

  /** Account standing + debt — combines DWH context, live EFS balance, and CMP invoice debt. */
  getCarrierOverview(carrierId: string) {
    return crmGet(`/api/agent/dwh/carrier-overview/${encodeURIComponent(carrierId)}`);
  },

  /** The carrier's fuel cards (DWH mart). */
  getCards(carrierId: string) {
    return crmGet<CarrierRowList>(`/api/agent/dwh/cards/${encodeURIComponent(carrierId)}`);
  },

  /** Per-card last-used date (DWH mart). */
  getLastUsed(carrierId: string, range?: string) {
    return crmGet<CarrierRowList>(`/api/agent/dwh/cards/${encodeURIComponent(carrierId)}/last-used`, {
      range: range ?? 'all_time',
    });
  },

  /** Fuel transaction line items (DWH mart). `range` follows servercrm's vocabulary
   * (day/week/month/quarter/half_year/year/all_time), overridden to 'custom' when from+to are set. */
  getTransactions(carrierId: string, opts: TransactionsRangeOpts = {}) {
    return crmGet<CarrierTransactions>(`/api/agent/dwh/transactions/${encodeURIComponent(carrierId)}`, {
      range: opts.from && opts.to ? 'custom' : (opts.range ?? 'month'),
      ...(opts.from ? { from: opts.from } : {}),
      ...(opts.to ? { to: opts.to } : {}),
      limit: opts.limit ?? 100,
    });
  },

  /** Billing-cycle + invoice/payment totals over a trailing window (default 90 days). */
  getPaymentInfo(carrierId: string) {
    return crmGet(`/api/agent/dwh/payment-info/${encodeURIComponent(carrierId)}`, { days: 90 });
  },

  /** Invoice list (DWH's `public.cmp_invoice` replica). `carrierId` is a query param here, not a path segment. */
  getInvoices(carrierId: string, opts: InvoicesRangeOpts = {}) {
    return crmGet<CarrierInvoices>('/api/salesMytrion/fetchInvoices', {
      carrierId,
      range: opts.from && opts.to ? 'custom' : (opts.range ?? 'last_30'),
      ...(opts.status ? { status: opts.status } : {}),
      ...(opts.from ? { from: opts.from } : {}),
      ...(opts.to ? { to: opts.to } : {}),
    });
  },

  /** A time-limited signed URL for one invoice's PDF. Not itself carrier-scoped upstream — callers
   * must verify ownership (e.g. via getInvoices) before minting one. */
  getInvoiceSignedUrl(invoiceId: string, type: 'pdf' | 'xlsx' | 'csv' = 'pdf') {
    return crmGet(`/api/salesMytrion/invoices/${encodeURIComponent(invoiceId)}/signed-url`, { type });
  },

  /** C-17 step 1 — the drawable money-code window for a carrier: `{ eligible, available, drawn,
   * moneycode_reasons[] … }`. servercrm computes the limit (a % of the latest invoice); the caller
   * must treat this as the ONLY source of truth and never invent a limit client-side. */
  getMoneyCodePreview(carrierId: string) {
    return crmGet(`/api/agent/dwh/money-code/${encodeURIComponent(carrierId)}`);
  },

  /** C-17 step 2 — draw against the window. Mirrors the agent widget's body exactly
   * (`moneycode_reason` / `unit_number` are servercrm's field names). A 422 means the window moved
   * (someone drew concurrently) — the error body carries the fresh `available`. The code value is
   * never in the response; delivery to the carrier happens upstream. */
  drawMoneyCode(
    carrierId: string,
    opts: { amount: number; unitNumber: string; reason: string; requestedBy?: string | undefined },
  ) {
    return crmPost('/api/agent/dwh/money-code/draw', {
      carrierId,
      amount: opts.amount,
      moneycode_reason: opts.reason,
      unit_number: opts.unitNumber,
      ...(opts.requestedBy ? { requestedBy: opts.requestedBy } : {}),
    });
  },

  /** C-24 safe-void — servercrm's EFS-safe decision tree; it updates money_code_requests itself.
   * The response never carries the code value. */
  voidMoneyCode(opts: { requestId: number; requestedBy: string; reason?: string | undefined }) {
    return crmPost('/api/agent/dwh/money-code/void', {
      requestId: opts.requestId,
      requestedBy: opts.requestedBy,
      ...(opts.reason ? { reason: opts.reason } : {}),
    });
  },
};
