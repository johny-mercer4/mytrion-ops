/**
 * Admin read API for durable Ops ownership transfer log
 * (`retention_ownership_transfers`).
 */
import { DEFAULT_TENANT_ID } from '../../config/constants.js';
import type { RetentionOwnershipTransfer } from '../../db/schema/retention_ownership_transfers.js';
import { listOwnershipTransfers } from '../../repos/retentionOwnershipTransferRepo.js';
import type { TenantContext } from '../../types/tenantContext.js';

export interface AdminOwnershipTransferDto {
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

function mapOwnershipTransferRow(row: RetentionOwnershipTransfer): AdminOwnershipTransferDto {
  return {
    id: row.id,
    createdAt:
      row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    reason: row.reason,
    result: row.result,
    dealName: row.dealName,
    contactName: row.contactName,
    companyName: row.companyName,
    zohoDealId: row.zohoDealId,
    zohoContactId: row.zohoContactId,
    zohoAccountId: row.zohoAccountId,
    carrierId: row.carrierId,
    retentionCaseId: row.retentionCaseId,
    fromOwnerZohoUserId: row.fromOwnerZohoUserId,
    fromOwnerName: row.fromOwnerName,
    toOwnerZohoUserId: row.toOwnerZohoUserId,
    toOwnerName: row.toOwnerName,
    actorZohoUserId: row.actorZohoUserId,
    actorName: row.actorName,
    dealUpdated: row.dealUpdated,
    contactUpdated: row.contactUpdated,
    accountUpdated: row.accountUpdated,
    warnings: row.warnings,
    errorMessage: row.errorMessage,
  };
}

export async function listAdminOwnershipTransfers(
  ctx: TenantContext,
  opts: {
    zohoDealId?: string | null;
    fromOwnerZohoUserId?: string | null;
    toOwnerZohoUserId?: string | null;
    reason?: string | null;
    limit?: number;
  } = {},
): Promise<AdminOwnershipTransferDto[]> {
  const rows = await listOwnershipTransfers({
    tenantId: ctx.tenantId || DEFAULT_TENANT_ID,
    ...(opts.zohoDealId != null ? { zohoDealId: opts.zohoDealId } : {}),
    ...(opts.fromOwnerZohoUserId != null
      ? { fromOwnerZohoUserId: opts.fromOwnerZohoUserId }
      : {}),
    ...(opts.toOwnerZohoUserId != null ? { toOwnerZohoUserId: opts.toOwnerZohoUserId } : {}),
    ...(opts.reason != null ? { reason: opts.reason } : {}),
    ...(opts.limit != null ? { limit: opts.limit } : {}),
  });
  return rows.map(mapOwnershipTransferRow);
}
