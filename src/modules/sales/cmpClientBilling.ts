/**
 * Overlay live CMP company credit / LOC terms onto the DWH dim_company billing
 * row used by Horizon ClientModal → Billing.
 *
 * CMP fields (servercrm GET /api/clients/:carrierId/credit):
 *   credit_limit, payment_terms (SYSTEM tag), billing_cycle, payment_day
 *
 * CMP does not expose credit_remaining — do not invent it from cmp_balance.
 */

import { serverCrm } from '../../integrations/serverCrm.js';

export interface CmpCarrierCredit {
  credit_limit?: number | null;
  payment_terms?: string | null;
  billing_cycle?: string | null;
  billing_cycle_label?: string | null;
  payment_day?: string | null;
  source?: string;
}

export interface ClientBillingTermsLike {
  billingCycle: string | null;
  billingCycleTag: string | null;
  paymentTerms: string | null;
  paymentDay: string | null;
  creditLimit: string | null;
  minimumRequiredBalance: string | null;
}

function strOrNull(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

/**
 * Prefer CMP creditLimit + LOC/Prepay terms when present; keep DWH min-balance
 * and any CMP-absent fields.
 */
export function overlayCmpCreditOnBilling(
  billing: ClientBillingTermsLike,
  cmp: CmpCarrierCredit | null | undefined,
): { billing: ClientBillingTermsLike; creditSource: 'cmp' | 'dwh' } {
  if (!cmp) return { billing, creditSource: 'dwh' };

  return {
    billing: {
      ...billing,
      creditLimit: strOrNull(cmp.credit_limit) ?? billing.creditLimit,
      paymentTerms: strOrNull(cmp.payment_terms) ?? billing.paymentTerms,
      billingCycle: strOrNull(cmp.billing_cycle) ?? billing.billingCycle,
      billingCycleTag: strOrNull(cmp.billing_cycle_label) ?? billing.billingCycleTag,
      paymentDay: strOrNull(cmp.payment_day) ?? billing.paymentDay,
    },
    // dwh_fallback still applies usable values but must not claim live CMP.
    creditSource: cmp.source === 'cmp' ? 'cmp' : 'dwh',
  };
}

/** Fetch CMP credit and overlay onto a DWH billing row. CMP errors → DWH-only. */
export async function applyLiveCmpCredit(
  carrierId: string,
  billing: ClientBillingTermsLike | null,
): Promise<{ billing: ClientBillingTermsLike | null; creditSource: 'cmp' | 'dwh' }> {
  if (!billing) return { billing: null, creditSource: 'dwh' };
  try {
    const cmp = await serverCrm.get<CmpCarrierCredit>(
      `/api/clients/${encodeURIComponent(carrierId)}/credit`,
    );
    return overlayCmpCreditOnBilling(billing, cmp);
  } catch {
    return { billing, creditSource: 'dwh' };
  }
}
