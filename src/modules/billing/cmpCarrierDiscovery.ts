/**
 * Resolve a carrier id from CMP directly, by company name — replaces relying on the local
 * `payment_carrier_memory`/DWH fuzzy match (`fuzzyCarrier.ts`) for MX return reversal, per an
 * explicit user decision: that local data is not reliable for this task, and CMP itself should be
 * searched instead.
 *
 * Thin wrapper over servercrm's `GET /api/billing/cmp/carrier-by-name` (backed by
 * `services/cmpCarrierByName.js`), which does the actual specificity gate, 3-stage CMP sweep,
 * honor-check, word-boundary re-check, and disambiguation — see that file for the full rationale
 * and the empirical evidence that CMP's `/api/invoices` honors an undocumented `companyName` param.
 */
import { serverCrm } from '../../integrations/serverCrm.js';

export interface CarrierCandidate {
  carrierId: string;
  companyName: string;
}

export interface CarrierDiscoveryResult {
  carrierId: string | null;
  companyName?: string | undefined;
  via?: string | undefined;
  candidates: CarrierCandidate[];
  message?: string | undefined;
}

interface DiscoveryResponse {
  status: 'success' | 'ambiguous' | 'not_found';
  carrierId?: string;
  companyName?: string;
  via?: string;
  candidates?: CarrierCandidate[];
  message?: string;
}

/** Throws on a servercrm/network failure — the caller (returnsCmpReversal.ts) already catches. */
export async function discoverCarrierByName(p: {
  companyName: string;
  invoiceNumber?: string | undefined;
}): Promise<CarrierDiscoveryResult> {
  const res = await serverCrm.get<DiscoveryResponse>('/api/billing/cmp/carrier-by-name', {
    companyName: p.companyName,
    ...(p.invoiceNumber ? { invoiceNumber: p.invoiceNumber } : {}),
  });
  return {
    carrierId: res.status === 'success' ? (res.carrierId ?? null) : null,
    companyName: res.companyName,
    via: res.via,
    candidates: res.candidates ?? [],
    message: res.message,
  };
}
