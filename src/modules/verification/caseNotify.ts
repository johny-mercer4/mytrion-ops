import { createInboxMessage } from '../inbox/service.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { VERIFICATION_CASE_OWNER_NAME } from './verificationOwner.js';

export const VERIFICATION_INBOX_TAG = 'verification';

/**
 * Tell the SALES agent an application landed for them to complete.
 *
 * Deliberately addressed to the Deal's owner, not the Verification desk: a cron-created application
 * is work for Sales first, and the desk sees every case in its queue anyway. Notifying Verification
 * about a row they cannot yet work is noise.
 */
export async function notifyApplicationAwaitingIntake(
  ctx: TenantContext,
  input: {
    caseId: string;
    ownerZohoUserId: string | null | undefined;
    ownerName?: string | null | undefined;
    companyName: string;
    zohoDealId: string;
  },
): Promise<void> {
  const owner = (input.ownerZohoUserId ?? '').trim();
  // No owner means nobody to tell. Writing an unaddressed inbox row would just hide the problem.
  if (!owner) return;

  const company = input.companyName.trim() || `Deal ${input.zohoDealId}`;
  await createInboxMessage(ctx, {
    ownerZohoUserId: owner,
    ownerName: (input.ownerName ?? '').trim() || VERIFICATION_CASE_OWNER_NAME,
    subject: `Application to complete · ${company}`,
    name: company,
    content:
      `An application was created from Zoho Deal ${input.zohoDealId}. ` +
      'Verification cannot start until the intake details and documents are filled in.',
    type: 'verification.application.awaiting_intake',
    priority: 'medium',
    tag: VERIFICATION_INBOX_TAG,
    sourceUrl: `/sales/verification/${input.caseId}`,
    zohoRecordId: `vc:${input.caseId}`,
  });
}

export async function notifyVerificationCaseCreated(
  ctx: TenantContext,
  input: {
    caseId: string;
    ownerZohoUserId: string;
    companyName: string;
    zohoDealId: string;
  },
): Promise<void> {
  const company = input.companyName.trim() || `Deal ${input.zohoDealId}`;
  await createInboxMessage(ctx, {
    ownerZohoUserId: input.ownerZohoUserId,
    ownerName: VERIFICATION_CASE_OWNER_NAME,
    subject: `New verification case · ${company}`,
    name: company,
    content: `A new verification case was ingested from Zoho Deal ${input.zohoDealId}.`,
    type: 'verification.case.created',
    priority: 'medium',
    tag: VERIFICATION_INBOX_TAG,
    sourceUrl: `/verification/cases/${input.caseId}`,
    zohoRecordId: `vc:${input.caseId}`,
  });
}
