/**
 * Ops one-shot: return XPEDITED FREIGHT LLC (case 414 / carrier 5800330) Deal +
 * Contact + Account ownership to Daniel Brown after Open Pool claim UX test.
 * Also restores the local retention case assignee to Daniel.
 *
 * Usage: corepack pnpm exec tsx scripts/revertXpeditedToDaniel.ts
 */
import 'dotenv/config';
import { closeDb } from '../src/db/client.js';
import { OWNERSHIP_TRANSFER_REASON } from '../src/db/schema/retention_ownership_transfers.js';
import { DEFAULT_TENANT_ID } from '../src/config/constants.js';
import { buildSystemContext } from '../src/modules/jobs/systemContext.js';
import { transferDealOwnershipToClaimant } from '../src/modules/retention/zohoOwnership.js';
import { retentionCaseRepo } from '../src/repos/retentionCaseRepo.js';
import { zohoCrmRecords } from '../src/integrations/zohoCrmRecords.js';

const DANIEL_ZOHO = '6227679000031473048';
const DANIEL_NAME = 'Daniel Brown';
const CASE_ID = '414';
const CARRIER_ID = '5800330';

function ownerId(value: unknown): string | null {
  if (value == null || typeof value !== 'object') return null;
  const id = (value as { id?: unknown }).id;
  return typeof id === 'string' && id.trim() ? id.trim() : null;
}

function ownerName(value: unknown): string | null {
  if (value == null || typeof value !== 'object') return null;
  const name = (value as { name?: unknown }).name;
  return typeof name === 'string' && name.trim() ? name.trim() : null;
}

async function main(): Promise<void> {
  const ctx = buildSystemContext(['retention', 'sales', 'admin']);

  const caseRow = await retentionCaseRepo.findById(ctx, CASE_ID);
  if (!caseRow) throw new Error(`Case ${CASE_ID} not found`);
  if (caseRow.carrierId !== CARRIER_ID) {
    throw new Error(`Case ${CASE_ID} carrier mismatch: ${caseRow.carrierId}`);
  }

  const dealId = caseRow.zohoDealId?.trim();
  if (!dealId) throw new Error(`Case ${CASE_ID} has no zoho_deal_id`);

  console.log(
    JSON.stringify(
      {
        before: {
          caseId: String(caseRow.id),
          company: caseRow.companyName,
          carrierId: caseRow.carrierId,
          zohoDealId: dealId,
          status: caseRow.statusCode,
          assignee: caseRow.assignedAgentZohoUserId,
          agentName: caseRow.agentName,
          poolOwner: caseRow.poolOwnerZohoUserId,
          assignmentCount: caseRow.assignmentCount,
          openPoolAttemptCount: caseRow.openPoolAttemptCount,
        },
      },
      null,
      2,
    ),
  );

  const transfer = await transferDealOwnershipToClaimant(dealId, DANIEL_ZOHO, {
    tenantId: ctx.tenantId || DEFAULT_TENANT_ID,
    reason: OWNERSHIP_TRANSFER_REASON.manualRevert,
    retentionCaseId: Number(caseRow.id),
    carrierId: caseRow.carrierId,
    companyName: caseRow.companyName,
    dealName: caseRow.companyName,
    actorZohoUserId: null,
    actorName: 'ops:revert-xpedited-to-daniel',
    toOwnerName: DANIEL_NAME,
  });

  // Undo claim finalize increments when this was the claim UX test.
  const nextAssignment = Math.max(1, caseRow.assignmentCount - 1);
  const nextPoolAttempts = Math.max(0, caseRow.openPoolAttemptCount - 1);

  const updated = await retentionCaseRepo.update(ctx, CASE_ID, {
    assignedAgentZohoUserId: DANIEL_ZOHO,
    agentName: DANIEL_NAME,
    poolOwnerZohoUserId: null,
    pendingClaimantZohoUserId: null,
    dealOwnerChanged: true,
    assignmentCount: nextAssignment,
    openPoolAttemptCount: nextPoolAttempts,
    statusCode: 'p1_new',
    agentOutcome: null,
    eventType: 'reassigned',
    eventNotes: 'Ops revert: Open Pool claim UX test — ownership returned to Daniel Brown',
    actorZohoUserId: DANIEL_ZOHO,
  });

  const deal = await zohoCrmRecords.getRecord('Deals', dealId);
  const contactId = transfer.contactId;
  const accountId = transfer.accountId;
  const contact = contactId ? await zohoCrmRecords.getRecord('Contacts', contactId) : null;
  const account = accountId ? await zohoCrmRecords.getRecord('Accounts', accountId) : null;

  console.log(
    JSON.stringify(
      {
        ok: true,
        zoho: {
          dealId: transfer.dealId,
          contactId: transfer.contactId,
          accountId: transfer.accountId,
          dealUpdated: transfer.dealUpdated,
          contactUpdated: transfer.contactUpdated,
          accountUpdated: transfer.accountUpdated,
          fromOwnerZohoUserId: transfer.fromOwnerZohoUserId,
          fromOwnerName: transfer.fromOwnerName,
          warnings: transfer.warnings,
          verifiedOwners: {
            deal: { id: ownerId(deal?.Owner), name: ownerName(deal?.Owner) },
            contact: contact
              ? { id: ownerId(contact.Owner), name: ownerName(contact.Owner) }
              : null,
            account: account
              ? { id: ownerId(account.Owner), name: ownerName(account.Owner) }
              : null,
          },
        },
        case: updated
          ? {
              caseId: String(updated.id),
              status: updated.statusCode,
              assignee: updated.assignedAgentZohoUserId,
              agentName: updated.agentName,
              assignmentCount: updated.assignmentCount,
              openPoolAttemptCount: updated.openPoolAttemptCount,
            }
          : null,
      },
      null,
      2,
    ),
  );
}

main()
  .then(() => closeDb())
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error(err);
    await closeDb().catch(() => undefined);
    process.exit(1);
  });
