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

// ---- Real-time mapping relay (Phase 3b) ----

export type MappingAction = 'map' | 'unmap' | 'returned';

export interface MappingBroadcast {
  action: MappingAction;
  transactionRecordId: string;
  source?: string;
  carrierId?: string;
  mappingType?: string;
  mappedAt?: string;
  /** This client's stable session id — the server echoes it so we ignore our own event. */
  originId: string;
}

/**
 * Relay a local mapping change to peers via the backend proxy (which forwards to servercrm's
 * WebSocket hub with the server-side key). Best-effort and fire-and-forget — a relay failure
 * must never surface as a mapping failure.
 */
export function broadcastMapping(payload: MappingBroadcast): void {
  void request('POST', '/billing/mapping-event', {
    headers: BILLING_HEADERS,
    body: payload,
  }).catch(() => undefined);
}
