/**
 * Who besides an admin may hard-delete a manually-entered payment_transactions row. Backend:
 * paymentDeleteGrants.routes.ts. Shaped like permissionSets.ts's roster convention — one snapshot
 * GET returns both the current grants and every active worker with `granted` precomputed, so the
 * screen can offer "add by name" without a second round trip.
 */
import { request } from './transport';

export interface PaymentDeleteGrant {
  id: number;
  zohoUserId: string;
  source: string;
  grantedBy: string | null;
  createdAt: string;
}

export interface PaymentDeleteRosterEntry {
  zohoUserId: string;
  name: string | null;
  email: string | null;
  granted: boolean;
}

export interface PaymentDeleteGrantsSnapshot {
  grants: PaymentDeleteGrant[];
  roster: PaymentDeleteRosterEntry[];
}

const opts = { impersonate: false } as const;

export async function getPaymentDeleteGrants(source = 'chase'): Promise<PaymentDeleteGrantsSnapshot> {
  return (await request('GET', '/billing/delete-grants', {
    ...opts,
    query: { source },
  })) as PaymentDeleteGrantsSnapshot;
}

export async function grantPaymentDelete(zohoUserId: string, source = 'chase'): Promise<PaymentDeleteGrant> {
  const data = (await request('POST', '/billing/delete-grants', {
    ...opts,
    body: { zohoUserId, source },
  })) as { grant: PaymentDeleteGrant };
  return data.grant;
}

export async function revokePaymentDelete(zohoUserId: string, source = 'chase'): Promise<void> {
  await request('DELETE', '/billing/delete-grants', { ...opts, body: { zohoUserId, source } });
}
