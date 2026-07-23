/**
 * Append-only ownership transfer log. Never cascade-deletes with cases.
 */
import { db } from '../db/client.js';
import {
  retentionOwnershipTransfers,
  type OwnershipTransferReason,
  type OwnershipTransferResultCode,
} from '../db/schema/retention_ownership_transfers.js';
import { logger } from '../lib/logger.js';

export interface InsertOwnershipTransferInput {
  tenantId: string;
  retentionCaseId?: number | null;
  carrierId?: string | null;
  companyName?: string | null;
  zohoDealId?: string | null;
  zohoContactId?: string | null;
  zohoAccountId?: string | null;
  reason: OwnershipTransferReason | string;
  result: OwnershipTransferResultCode;
  fromOwnerZohoUserId?: string | null;
  fromOwnerName?: string | null;
  toOwnerZohoUserId: string;
  toOwnerName?: string | null;
  actorZohoUserId?: string | null;
  actorName?: string | null;
  dealUpdated?: boolean;
  contactUpdated?: boolean;
  accountUpdated?: boolean;
  warnings?: string[] | string | null;
  errorMessage?: string | null;
}

function warningsText(warnings: string[] | string | null | undefined): string | null {
  if (warnings == null) return null;
  if (typeof warnings === 'string') {
    const t = warnings.trim();
    return t || null;
  }
  const joined = warnings.map((w) => w.trim()).filter(Boolean).join('; ');
  return joined || null;
}

/** Best-effort insert — never throws (transfer path must not fail on audit write). */
export async function insertOwnershipTransfer(
  input: InsertOwnershipTransferInput,
): Promise<void> {
  try {
    const toOwner = input.toOwnerZohoUserId.trim();
    if (!toOwner) {
      logger.warn({ input }, 'ownership transfer log skipped: empty toOwnerZohoUserId');
      return;
    }
    await db.insert(retentionOwnershipTransfers).values({
      tenantId: input.tenantId,
      retentionCaseId:
        input.retentionCaseId != null && Number.isFinite(input.retentionCaseId)
          ? input.retentionCaseId
          : null,
      carrierId: input.carrierId?.trim() || null,
      companyName: input.companyName?.trim() || null,
      zohoDealId: input.zohoDealId?.trim() || null,
      zohoContactId: input.zohoContactId?.trim() || null,
      zohoAccountId: input.zohoAccountId?.trim() || null,
      reason: input.reason,
      result: input.result,
      fromOwnerZohoUserId: input.fromOwnerZohoUserId?.trim() || null,
      fromOwnerName: input.fromOwnerName?.trim() || null,
      toOwnerZohoUserId: toOwner,
      toOwnerName: input.toOwnerName?.trim() || null,
      actorZohoUserId: input.actorZohoUserId?.trim() || null,
      actorName: input.actorName?.trim() || null,
      dealUpdated: input.dealUpdated ?? false,
      contactUpdated: input.contactUpdated ?? false,
      accountUpdated: input.accountUpdated ?? false,
      warnings: warningsText(input.warnings),
      errorMessage: input.errorMessage?.trim() || null,
    });
  } catch (err) {
    logger.warn(
      {
        err: err instanceof Error ? err.message : String(err),
        dealId: input.zohoDealId,
        reason: input.reason,
      },
      'ownership transfer log insert failed',
    );
  }
}

export const retentionOwnershipTransferRepo = {
  insert: insertOwnershipTransfer,
};
