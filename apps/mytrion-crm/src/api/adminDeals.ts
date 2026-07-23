/** Admin Deals — org-wide list/search + ownership transfer + Owner_Logs. */
import { request } from './transport';

/** John Mercer — default transferrer filter for ownership-change discovery. */
export const DEFAULT_TRANSFERRER_ZOHO_USER_ID = '6227679000093960901';

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
 * Recovery deal set + Timeline `done_by` filter (not Owner_Logs.Created_By —
 * that field is often the workflow user).
 */
export async function listDealsTransferredBy(
  transferrerId: string,
  limit = 200,
): Promise<{
  deals: AdminDeal[];
  timeline: Array<{ dealId: string; change: OwnerTimelineChange }>;
}> {
  const data = await request('GET', '/admin/deals', {
    impersonate: false,
    query: { transferredBy: transferrerId, limit },
  });
  const body = data as {
    deals?: AdminDeal[];
    timeline?: Array<{ dealId: string; change: OwnerTimelineChange }>;
  };
  return { deals: body.deals ?? [], timeline: body.timeline ?? [] };
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

/** Durable Mytrion Ops ownership transfer log (not Zoho Owner_Logs). */
export interface OwnershipTransferLog {
  id: number;
  createdAt: string;
  reason: string;
  result: string;
  dealName: string | null;
  contactName: string | null;
  companyName: string | null;
  zohoDealId: string | null;
  zohoContactId: string | null;
  zohoAccountId: string | null;
  carrierId: string | null;
  retentionCaseId: number | null;
  fromOwnerZohoUserId: string | null;
  fromOwnerName: string | null;
  toOwnerZohoUserId: string;
  toOwnerName: string | null;
  actorZohoUserId: string | null;
  actorName: string | null;
  dealUpdated: boolean;
  contactUpdated: boolean;
  accountUpdated: boolean;
  warnings: string | null;
  errorMessage: string | null;
}

export async function listOwnershipTransferLogs(opts: {
  zohoDealId?: string;
  fromOwnerZohoUserId?: string;
  toOwnerZohoUserId?: string;
  reason?: string;
  limit?: number;
} = {}): Promise<OwnershipTransferLog[]> {
  const data = await request('GET', '/admin/ownership-transfers', {
    impersonate: false,
    query: {
      ...(opts.zohoDealId ? { zohoDealId: opts.zohoDealId } : {}),
      ...(opts.fromOwnerZohoUserId ? { fromOwnerZohoUserId: opts.fromOwnerZohoUserId } : {}),
      ...(opts.toOwnerZohoUserId ? { toOwnerZohoUserId: opts.toOwnerZohoUserId } : {}),
      ...(opts.reason ? { reason: opts.reason } : {}),
      ...(opts.limit != null ? { limit: opts.limit } : {}),
    },
  });
  return (data as { transfers?: OwnershipTransferLog[] }).transfers ?? [];
}
