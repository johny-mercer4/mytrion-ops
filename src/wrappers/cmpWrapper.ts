/**
 * Named façade over the CMP-touching servercrm endpoints — CMP itself (a login/password fuel-card
 * management system) is never reached directly from here; servercrm holds the live REST client
 * (servercrm/services/cmpAuth.js + cmpClients.js). This wrapper only formalizes the HTTP surface, it
 * doesn't call CMP itself — see src/integrations/cmp.ts for the dormant direct-REST client (unused
 * by design; kept for a future direct-CMP path if servercrm is ever bypassed).
 *
 * Scaffolded from servercrm's route inventory (research pass, not yet exercised by a live caller in
 * this repo) — verify request/response shapes against a real call before trusting field names.
 */
import { crmGet, crmPost } from './serverCrmClient.js';

export const cmpWrapper = {
  /** Live CMP debt overlay for a set of carriers (distinct from the DWH-cached debtors list, which
   * reads the ~3h-stale `cmp_invoice` replica instead). */
  getDebtors(carrierIds: string[]) {
    return crmPost<{ data?: Array<Record<string, unknown>> }>('/api/agent/cmp/debtors', { carrierIds });
  },

  /** The invoice's PDF, fetched live from CMP (not the signed-URL redirect flow — a direct proxy). */
  getInvoicePdf(invoiceId: string) {
    return crmGet(`/api/salesMytrion/invoices/${encodeURIComponent(invoiceId)}/pdf`);
  },

  /** The invoice's Excel export, fetched live from CMP. */
  getInvoiceExcel(invoiceId: string) {
    return crmGet(`/api/salesMytrion/invoices/${encodeURIComponent(invoiceId)}/excel`);
  },
};
