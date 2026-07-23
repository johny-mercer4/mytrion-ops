/**
 * Transfer Zoho CRM Deal (+ linked Contact / Account) Owner to an Open Pool claimant.
 *
 * Invariant: Deal Owner update is required (fail closed). Contact / Account Owner updates
 * are best-effort — logged on failure; local claim finalize still proceeds if Deal succeeded.
 *
 * Every transfer (success / partial / failed) writes an append-only row to
 * `retention_ownership_transfers` when audit context is provided — survives case delete.
 */
import { zohoCrmRecords } from '../../integrations/zohoCrmRecords.js';
import { AppError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import {
  OWNERSHIP_TRANSFER_RESULT,
  type OwnershipTransferReason,
} from '../../db/schema/retention_ownership_transfers.js';
import { insertOwnershipTransfer } from '../../repos/retentionOwnershipTransferRepo.js';

export interface OwnershipTransferResult {
  dealId: string;
  contactId: string | null;
  accountId: string | null;
  dealUpdated: boolean;
  contactUpdated: boolean;
  accountUpdated: boolean;
  warnings: string[];
  fromOwnerZohoUserId: string | null;
  fromOwnerName: string | null;
}

/** Context for durable ownership transfer audit (optional but preferred). */
export interface OwnershipTransferAudit {
  tenantId: string;
  reason: OwnershipTransferReason | string;
  retentionCaseId?: number | null;
  carrierId?: string | null;
  companyName?: string | null;
  dealName?: string | null;
  contactName?: string | null;
  actorZohoUserId?: string | null;
  actorName?: string | null;
  /** Display name for the new owner when known (CS / claimant). */
  toOwnerName?: string | null;
}

function lookupId(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string') {
    const t = value.trim();
    return t || null;
  }
  if (typeof value === 'object') {
    const id = (value as { id?: unknown }).id;
    if (typeof id === 'string' && id.trim()) return id.trim();
    if (typeof id === 'number' && Number.isFinite(id)) return String(id);
  }
  return null;
}

function lookupName(value: unknown): string | null {
  if (value == null || typeof value !== 'object') return null;
  const name = (value as { name?: unknown }).name;
  if (typeof name === 'string' && name.trim()) return name.trim();
  return null;
}

function ownerPayload(zohoUserId: string): { Owner: { id: string } } {
  return { Owner: { id: zohoUserId.trim() } };
}

async function persistTransferLog(
  audit: OwnershipTransferAudit | null | undefined,
  row: {
    zohoDealId: string;
    zohoContactId: string | null;
    zohoAccountId: string | null;
    dealName?: string | null;
    contactName?: string | null;
    companyName?: string | null;
    toOwnerZohoUserId: string;
    fromOwnerZohoUserId: string | null;
    fromOwnerName: string | null;
    dealUpdated: boolean;
    contactUpdated: boolean;
    accountUpdated: boolean;
    warnings: string[];
    errorMessage?: string | null;
    result: 'success' | 'partial' | 'failed';
  },
): Promise<void> {
  if (!audit?.tenantId) return;
  await insertOwnershipTransfer({
    tenantId: audit.tenantId,
    retentionCaseId: audit.retentionCaseId ?? null,
    carrierId: audit.carrierId ?? null,
    companyName: row.companyName ?? audit.companyName ?? null,
    dealName: row.dealName ?? audit.dealName ?? null,
    contactName: row.contactName ?? audit.contactName ?? null,
    zohoDealId: row.zohoDealId,
    zohoContactId: row.zohoContactId,
    zohoAccountId: row.zohoAccountId,
    reason: audit.reason,
    result: row.result,
    fromOwnerZohoUserId: row.fromOwnerZohoUserId,
    fromOwnerName: row.fromOwnerName,
    toOwnerZohoUserId: row.toOwnerZohoUserId,
    toOwnerName: audit.toOwnerName ?? null,
    actorZohoUserId: audit.actorZohoUserId ?? null,
    actorName: audit.actorName ?? null,
    dealUpdated: row.dealUpdated,
    contactUpdated: row.contactUpdated,
    accountUpdated: row.accountUpdated,
    warnings: row.warnings,
    errorMessage: row.errorMessage ?? null,
  });
}

/**
 * Load Deal by id, set Owner to claimant, then best-effort Contact + Account Owners.
 */
export async function transferDealOwnershipToClaimant(
  zohoDealId: string,
  claimantZohoUserId: string,
  audit?: OwnershipTransferAudit | null,
): Promise<OwnershipTransferResult> {
  const dealId = zohoDealId.trim();
  const claimant = claimantZohoUserId.trim();
  if (!dealId) {
    throw new AppError('Deal has no Zoho id — cannot transfer ownership', {
      statusCode: 409,
      code: 'RETENTION_NO_DEAL',
      expose: true,
    });
  }
  if (!claimant) {
    throw new AppError('Claimant Zoho user id is required', {
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      expose: true,
    });
  }

  const deal = await zohoCrmRecords.getRecord('Deals', dealId);
  if (!deal) {
    throw new AppError('Zoho Deal not found — cannot transfer ownership', {
      statusCode: 404,
      code: 'RETENTION_DEAL_NOT_FOUND',
      expose: true,
    });
  }

  const contactId = lookupId(deal.Contact_Name);
  const accountId = lookupId(deal.Account_Name);
  const fromOwnerZohoUserId = lookupId(deal.Owner);
  const fromOwnerName = lookupName(deal.Owner);
  const dealName =
    typeof deal.Deal_Name === 'string' && deal.Deal_Name.trim()
      ? deal.Deal_Name.trim()
      : (audit?.dealName ?? null);
  const contactName = lookupName(deal.Contact_Name) ?? audit?.contactName ?? null;
  const companyName = lookupName(deal.Account_Name) ?? audit?.companyName ?? null;
  const warnings: string[] = [];

  try {
    await zohoCrmRecords.updateRecord('Deals', dealId, ownerPayload(claimant));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ dealId, claimant, err: message }, 'retention zoho ownership: Deal Owner failed');
    await persistTransferLog(audit, {
      zohoDealId: dealId,
      zohoContactId: contactId,
      zohoAccountId: accountId,
      dealName,
      contactName,
      companyName,
      toOwnerZohoUserId: claimant,
      fromOwnerZohoUserId,
      fromOwnerName,
      dealUpdated: false,
      contactUpdated: false,
      accountUpdated: false,
      warnings: [],
      errorMessage: message,
      result: OWNERSHIP_TRANSFER_RESULT.failed,
    });
    throw new AppError(`Failed to update Deal Owner in Zoho: ${message}`, {
      statusCode: 502,
      code: 'RETENTION_ZOHO_OWNER_DEAL',
      expose: true,
    });
  }

  let contactUpdated = false;
  let accountUpdated = false;

  if (contactId) {
    try {
      await zohoCrmRecords.updateRecord('Contacts', contactId, ownerPayload(claimant));
      contactUpdated = true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      warnings.push(`Contact Owner update failed: ${message}`);
      logger.warn(
        { dealId, contactId, claimant, err: message },
        'retention zoho ownership: Contact Owner best-effort failed',
      );
    }
  }

  if (accountId) {
    try {
      await zohoCrmRecords.updateRecord('Accounts', accountId, ownerPayload(claimant));
      accountUpdated = true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      warnings.push(`Account Owner update failed: ${message}`);
      logger.warn(
        { dealId, accountId, claimant, err: message },
        'retention zoho ownership: Account Owner best-effort failed',
      );
    }
  }

  const result: OwnershipTransferResult = {
    dealId,
    contactId,
    accountId,
    dealUpdated: true,
    contactUpdated,
    accountUpdated,
    warnings,
    fromOwnerZohoUserId,
    fromOwnerName,
  };

  await persistTransferLog(audit, {
    zohoDealId: dealId,
    zohoContactId: contactId,
    zohoAccountId: accountId,
    dealName,
    contactName,
    companyName,
    toOwnerZohoUserId: claimant,
    fromOwnerZohoUserId,
    fromOwnerName,
    dealUpdated: true,
    contactUpdated,
    accountUpdated,
    warnings,
    result:
      warnings.length > 0
        ? OWNERSHIP_TRANSFER_RESULT.partial
        : OWNERSHIP_TRANSFER_RESULT.success,
  });

  return result;
}

/** Zoho Deal field for CITI handoff stage (confirm against live CRM metadata if writes fail). */
export const CITI_ASSIGNMENT_STAGE_FIELD = 'Assignment_Stage' as const;
export const CITI_ASSIGNMENT_STAGE_VALUE = 'CITI' as const;

/** Standard Deal pipeline stage API name / Closed Lost picklist value (org DWH). */
export const DEAL_STAGE_FIELD = 'Stage' as const;
export const DEAL_STAGE_CLOSED_LOST = 'Closed Lost' as const;

/** Best-effort write of Assignment Stage → CITI on a Deal. */
export async function setDealAssignmentStageCiti(zohoDealId: string): Promise<void> {
  const dealId = zohoDealId.trim();
  if (!dealId) return;
  await zohoCrmRecords.updateRecord('Deals', dealId, {
    [CITI_ASSIGNMENT_STAGE_FIELD]: CITI_ASSIGNMENT_STAGE_VALUE,
  });
}

/** Best-effort: Deal Stage → Closed Lost when a case enters CITI Folder. */
export async function setDealStageClosedLost(zohoDealId: string | null | undefined): Promise<void> {
  const dealId = zohoDealId?.trim();
  if (!dealId) return;
  try {
    await zohoCrmRecords.updateRecord('Deals', dealId, {
      [DEAL_STAGE_FIELD]: DEAL_STAGE_CLOSED_LOST,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ dealId, err: message }, 'retention zoho: Stage=Closed Lost failed (best-effort)');
  }
}
