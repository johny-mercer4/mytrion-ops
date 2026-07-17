/**
 * Billing Mytrion client (/v1/billing/* + the billing.* touchpoints). Every touchpoint call
 * pins departmentAccess to ['billing'] (the generic client defaults to sales); the deal-billing
 * edit is a REST write that carries the legacy department header. Mirrors api/cs.ts.
 */
import { request } from './transport';
import { callTouchpoint } from './touchpoints';
import type { TouchpointKey, TouchpointMap } from './touchpointTypes';

const BILLING_HEADERS = { 'x-department-access': 'billing' } as const;
const BILLING_DEPARTMENTS = ['billing'];

type BillingTouchpointKey = Extract<TouchpointKey, `billing.${string}`>;

/** billing.* touchpoint call with the billing department view pinned. */
export function billingTouchpoint<K extends BillingTouchpointKey>(
  key: K,
  params: TouchpointMap[K]['params'],
): Promise<TouchpointMap[K]['result']> {
  return callTouchpoint(key, params, { departmentAccess: BILLING_DEPARTMENTS });
}

// ---- Data Center deal-billing edit (direct Deals update via REST) ----

export function updateDealBilling(
  id: string,
  changes: Partial<{
    Payment_Type_Billing: string | null;
    Billing_Cycle: string | null;
    Billing_Verification: string | boolean | null;
  }>,
): Promise<{ id: string; updatedFields: string[] }> {
  return request('POST', `/billing/data-center/deals/${encodeURIComponent(id)}`, {
    headers: BILLING_HEADERS,
    body: changes,
  }) as Promise<{ id: string; updatedFields: string[] }>;
}
