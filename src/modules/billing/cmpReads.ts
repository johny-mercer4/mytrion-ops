/**
 * CMP read orchestration for Billing Mytrion. The only CMP *read* the app needs is the mapping
 * picker's per-carrier invoice list — it lives in CMP, not Postgres, so it is proxied through the
 * servercrm /api/billing/cmp/* surface (which holds the CMP credentials) exactly like the writes in
 * cmpWrites.ts. This replaces the last billing Deluge touchpoint (mytrionSearchInvoices).
 */
import { serverCrm } from '../../integrations/serverCrm.js';

export interface CmpInvoiceOption {
  id: string;
  invoiceNumber: string;
  status: string;
  totalAmount: number;
  totalMerchantFee: number;
  totalPaid: number;
  remainingAmount: number;
  period: string;
  createdDate: string;
}

export interface CmpInvoiceSearch {
  status: 'success';
  carrierId: string;
  invoices: CmpInvoiceOption[];
  summary: string;
  dateRange: string;
}

/** Last-365-day invoices for a carrier (the mapping picker) — via servercrm CMP. */
export async function searchCarrierInvoices(carrierId: string): Promise<CmpInvoiceSearch> {
  const r = await serverCrm.get<Partial<CmpInvoiceSearch>>(
    `/api/billing/cmp/carrier-invoices?carrierId=${encodeURIComponent(carrierId)}`,
  );
  return {
    status: 'success',
    carrierId: r.carrierId ?? carrierId,
    invoices: Array.isArray(r.invoices) ? r.invoices : [],
    summary: r.summary ?? '',
    dateRange: r.dateRange ?? '',
  };
}
