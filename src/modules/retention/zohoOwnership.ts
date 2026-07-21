/**
 * Transfer Zoho CRM Deal (+ linked Contact / Account) Owner to an Open Pool claimant.
 *
 * Invariant: Deal Owner update is required (fail closed). Contact / Account Owner updates
 * are best-effort — logged on failure; local claim finalize still proceeds if Deal succeeded.
 */
import { zohoCrmRecords } from '../../integrations/zohoCrmRecords.js';
import { AppError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';

export interface OwnershipTransferResult {
  dealId: string;
  contactId: string | null;
  accountId: string | null;
  dealUpdated: boolean;
  contactUpdated: boolean;
  accountUpdated: boolean;
  warnings: string[];
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

function ownerPayload(zohoUserId: string): { Owner: { id: string } } {
  return { Owner: { id: zohoUserId.trim() } };
}

/**
 * Load Deal by id, set Owner to claimant, then best-effort Contact + Account Owners.
 */
export async function transferDealOwnershipToClaimant(
  zohoDealId: string,
  claimantZohoUserId: string,
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
  const warnings: string[] = [];

  try {
    await zohoCrmRecords.updateRecord('Deals', dealId, ownerPayload(claimant));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ dealId, claimant, err: message }, 'retention zoho ownership: Deal Owner failed');
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

  return {
    dealId,
    contactId,
    accountId,
    dealUpdated: true,
    contactUpdated,
    accountUpdated,
    warnings,
  };
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
