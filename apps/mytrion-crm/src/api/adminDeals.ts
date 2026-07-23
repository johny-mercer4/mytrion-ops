/** Admin Deals — org-wide list/search + ownership transfer + Owner_Logs. */
import { request } from './transport';

export interface AdminDeal {
  id: string;
  dealName: string | null;
  ownerZohoUserId: string | null;
  ownerName: string | null;
  accountId: string | null;
  accountName: string | null;
  contactId: string | null;
  contactName: string | null;
  applicationDate: string | null;
  ownerLastUpdated: string | null;
  stage: string | null;
  carrierId: string | null;
  applicationId: string | null;
}

export interface AdminOwnerLog {
  id: string;
  name: string | null;
  module: string | null;
  entityId: string | null;
  newOwnerId: string | null;
  newOwnerName: string | null;
  transferrerZohoUserId: string | null;
  transferrerName: string | null;
  ownerLogTime: string | null;
  createdTime: string | null;
}

export interface OwnerTimelineChange {
  auditedTime: string | null;
  transferrerZohoUserId: string | null;
  transferrerName: string | null;
  previousOwnerName: string | null;
  previousOwnerZohoUserId: string | null;
  newOwnerName: string | null;
  newOwnerZohoUserId: string | null;
  source: string | null;
}

export interface AdminDealTransferResult {
  deal: AdminDeal;
  transfer: {
    dealUpdated: boolean;
    contactUpdated: boolean;
    accountUpdated: boolean;
    contactId: string | null;
    accountId: string | null;
    fromOwnerZohoUserId: string | null;
    fromOwnerName: string | null;
    warnings: string[];
  };
}

export async function listAdminDeals(limit = 200): Promise<AdminDeal[]> {
  const data = await request('GET', '/admin/deals', {
    impersonate: false,
    query: { limit },
  });
  return (data as { deals?: AdminDeal[] }).deals ?? [];
}

/**
 * Recovery deal set via Owner_Logs COQL (`Created_By` = transferrer), default page 1000.
 * Prior owner enriched from each deal's `__timeline`.
 */
export async function listDealsTransferredBy(
  transferrerId: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<{
  deals: AdminDeal[];
  timeline: Array<{ dealId: string; change: OwnerTimelineChange }>;
  offset: number;
  limit: number;
  hasMore: boolean;
  coql: string | null;
}> {
  const data = await request('GET', '/admin/deals', {
    impersonate: false,
    query: {
      transferredBy: transferrerId,
      limit: opts.limit ?? 1000,
      offset: opts.offset ?? 0,
    },
  });
  const body = data as {
    deals?: AdminDeal[];
    timeline?: Array<{ dealId: string; change: OwnerTimelineChange }>;
    offset?: number;
    limit?: number;
    hasMore?: boolean;
    coql?: string;
  };
  return {
    deals: body.deals ?? [],
    timeline: body.timeline ?? [],
    offset: body.offset ?? opts.offset ?? 0,
    limit: body.limit ?? opts.limit ?? 1000,
    hasMore: Boolean(body.hasMore),
    coql: body.coql ?? null,
  };
}

export async function searchAdminDeals(q: string): Promise<AdminDeal[]> {
  const data = await request('GET', '/admin/deals/search', {
    impersonate: false,
    query: { q },
  });
  return (data as { deals?: AdminDeal[] }).deals ?? [];
}

export async function getAdminDeal(
  dealId: string,
  opts?: { transferrerId?: string },
): Promise<{
  deal: AdminDeal;
  priorOwner: {
    zohoUserId: string | null;
    name: string | null;
    change: OwnerTimelineChange | null;
  } | null;
}> {
  const data = await request('GET', `/admin/deals/${encodeURIComponent(dealId)}`, {
    impersonate: false,
    query: {
      ...(opts?.transferrerId?.trim() ? { transferrerId: opts.transferrerId.trim() } : {}),
    },
  });
  return data as {
    deal: AdminDeal;
    priorOwner: {
      zohoUserId: string | null;
      name: string | null;
      change: OwnerTimelineChange | null;
    } | null;
  };
}

export async function transferAdminDeal(
  dealId: string,
  toZohoUserId: string,
  toOwnerName?: string | null,
): Promise<AdminDealTransferResult> {
  const data = await request('POST', `/admin/deals/${encodeURIComponent(dealId)}/transfer`, {
    impersonate: false,
    body: {
      toZohoUserId,
      ...(toOwnerName ? { toOwnerName } : {}),
    },
  });
  return data as AdminDealTransferResult;
}

export async function listOwnerLogs(opts: {
  module?: string;
  entityId?: string;
  newOwnerId?: string;
  transferrerId?: string;
  since?: string;
  limit?: number;
} = {}): Promise<AdminOwnerLog[]> {
  const data = await request('GET', '/admin/owner-logs', {
    impersonate: false,
    query: {
      ...(opts.module ? { module: opts.module } : {}),
      ...(opts.entityId ? { entityId: opts.entityId } : {}),
      ...(opts.newOwnerId ? { newOwnerId: opts.newOwnerId } : {}),
      ...(opts.transferrerId ? { transferrerId: opts.transferrerId } : {}),
      ...(opts.since ? { since: opts.since } : {}),
      ...(opts.limit != null ? { limit: opts.limit } : {}),
    },
  });
  return (data as { logs?: AdminOwnerLog[] }).logs ?? [];
}
